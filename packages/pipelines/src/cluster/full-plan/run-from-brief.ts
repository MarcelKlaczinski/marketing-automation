// Spec 62.8: extracted cluster-creation pipeline so the plan-execution worker
// can invoke the same logic that backs `POST /clusters/full-plan` without
// going through HTTP. The route handler still exists (unchanged) for the
// manual cluster-creation UX; the duplication is intentional — refactoring
// the HTTP route to consume this helper is a follow-up.
//
// The function:
//   1. Loads the brief, project context, existing pillars + clusters
//   2. Computes a cluster embedding (best-effort — Voyage failure is non-fatal)
//   3. Calls `generateClusterPlan()` (free-function LLM, Memory D127)
//   4. Atomically: creates / resolves the pillar, INSERTs the cluster row in
//      `plan_proposed` status, sets the brief to `routed`
//   5. Returns the new cluster id so the executor can attach the
//      pipeline_run_id mapping on planned_items
//
// What it intentionally does NOT do:
//   - Run cost-budget pre-flight (the 62.8 executor's 90% gate runs first)
//   - Auto-approve the cluster plan / fan out spokes (Marcel still reviews the
//     plan in the Clusters tab per the user's 62.8 design call)
//   - Validate `brief.source === 'trend_discovery'` — planner-emitted items
//     may originate from any source the planner matched to `cluster` content
//     type. The brief existence check + ownership check are the guards.

import { voyage } from "@marketing-auto/adapter-voyage";
import {
  and,
  clusters,
  contentPillars,
  db,
  eq,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import type { ProposedHub, ProposedSpoke } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { generateClusterPlan } from "./llm-call.ts";

const log = createLogger("pipelines:cluster-full-plan-run");

export interface RunClusterFullPlanInput {
  briefId: string;
  projectId: string;
  /** Threaded into the LLM call so cost_logs links to the parent pipeline run. */
  pipelineRunId?: string;
}

export interface RunClusterFullPlanResult {
  clusterId: string;
  pillarId: string;
  spokeCount: number;
}

export class ClusterFullPlanRunError extends Error {
  readonly code:
    | "brief_not_found"
    | "brief_project_mismatch"
    | "project_not_found"
    | "llm_failure"
    | "transaction_failure";
  readonly originalCause: unknown;
  constructor(code: ClusterFullPlanRunError["code"], message: string, originalCause?: unknown) {
    super(message);
    this.name = "ClusterFullPlanRunError";
    this.code = code;
    this.originalCause = originalCause;
  }
}

export async function runClusterFullPlanFromBrief(
  input: RunClusterFullPlanInput,
): Promise<RunClusterFullPlanResult> {
  // 1) Brief
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(eq(topicBriefs.id, input.briefId))
    .limit(1);
  if (!brief) {
    throw new ClusterFullPlanRunError("brief_not_found", `Brief ${input.briefId} not found`);
  }
  if (brief.projectId !== input.projectId) {
    throw new ClusterFullPlanRunError(
      "brief_project_mismatch",
      `Brief ${input.briefId} does not belong to project ${input.projectId}`,
    );
  }

  // 2) Project context — required by the LLM prompt
  const [proj] = await db
    .select({
      id: projects.id,
      name: projects.name,
      marketingContextMd: projects.marketingContextMd,
    })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!proj) {
    throw new ClusterFullPlanRunError(
      "project_not_found",
      `Project ${input.projectId} not found`,
    );
  }

  // 3) Existing pillars + clusters (capped) for the prompt's de-dup context
  const [existingPillars, existingClusters] = await Promise.all([
    db
      .select({ id: contentPillars.id, name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, proj.id)),
    db
      .select({ id: clusters.id, name: clusters.name })
      .from(clusters)
      .where(eq(clusters.projectId, proj.id))
      .limit(20),
  ]);

  // 4) Embedding — best-effort; planner-driven cluster creation should not fail
  //    because Voyage is degraded.
  const embeddingText = `${brief.topicTitle} ${brief.primaryKeyword ?? ""}`.trim();
  let clusterEmbedding: number[] = [];
  try {
    clusterEmbedding = await voyage.embed(embeddingText, {
      projectId: proj.id,
      operation: "cluster-full-plan-embed",
    });
  } catch (e) {
    log.warn({ err: e, projectId: proj.id }, "embedding failed — proceeding without");
  }

  // 5) LLM call
  let plan: Awaited<ReturnType<typeof generateClusterPlan>>;
  try {
    plan = await generateClusterPlan(
      {
        triggerBrief: brief,
        projectId: proj.id,
        projectName: proj.name,
        projectMarketingContextMd: proj.marketingContextMd ?? null,
        existingPillars,
        existingClusters,
      },
      input.pipelineRunId !== undefined ? { pipelineRunId: input.pipelineRunId } : undefined,
    );
  } catch (err) {
    throw new ClusterFullPlanRunError("llm_failure", "Cluster plan LLM failed", err);
  }

  // 6) Transaction
  let txResult: { clusterId: string; pillarId: string };
  try {
    txResult = await db.transaction(async (tx) => {
      // Resolve or create pillar
      let pillarId: string;
      if (plan.pillarId === "new") {
        const [newPillar] = await tx
          .insert(contentPillars)
          .values({ projectId: proj.id, name: plan.pillarSuggestedName! })
          .returning({ id: contentPillars.id });
        if (!newPillar) throw new Error("Failed to insert content pillar");
        pillarId = newPillar.id;
      } else {
        pillarId = plan.pillarId;
      }

      const [pillarRow] = await tx
        .select({ name: contentPillars.name })
        .from(contentPillars)
        .where(eq(contentPillars.id, pillarId))
        .limit(1);
      const pillarName = pillarRow?.name ?? plan.cluster.name;

      const [newCluster] = await tx
        .insert(clusters)
        .values({
          projectId: proj.id,
          pillarId,
          name: plan.cluster.name,
          pillar: pillarName,
          primaryKeyword: plan.cluster.primaryKeyword,
          cornerstoneKeywords: [plan.hub.primaryKeyword],
          satelliteKeywords: [],
          status: "proposed",
          generationStatus: "plan_proposed",
          triggerBriefId: brief.id,
          proposedSpokes: plan.spokes as ProposedSpoke[],
          proposedHub: plan.hub as ProposedHub,
          planEdits: [],
        })
        .returning({ id: clusters.id });
      if (!newCluster) throw new Error("Failed to insert cluster");

      if (clusterEmbedding.length > 0) {
        await tx.execute(sql`
          UPDATE clusters
          SET embedding = ${JSON.stringify(clusterEmbedding)}::vector
          WHERE id = ${newCluster.id}
        `);
      }

      // Mark brief routed. Planner-driven clusters may come from briefs whose
      // approvalStatus is already 'approved' (planner only loads approved briefs
      // into floor selection); flip to 'routed' regardless.
      await tx
        .update(topicBriefs)
        .set({
          approvalStatus: "routed",
          approvedAt: brief.approvedAt ?? new Date(),
          routedClusterId: newCluster.id,
          updatedAt: new Date(),
        })
        .where(and(eq(topicBriefs.id, brief.id), eq(topicBriefs.projectId, proj.id)));

      return { clusterId: newCluster.id, pillarId };
    });
  } catch (err) {
    throw new ClusterFullPlanRunError(
      "transaction_failure",
      err instanceof Error ? err.message : "transaction failed",
      err,
    );
  }

  log.info(
    {
      projectId: proj.id,
      briefId: brief.id,
      clusterId: txResult.clusterId,
      spokeCount: plan.spokes.length,
    },
    "cluster full-plan created from brief",
  );

  return {
    clusterId: txResult.clusterId,
    pillarId: txResult.pillarId,
    spokeCount: plan.spokes.length,
  };
}
