import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  db,
  eq,
  topicBriefs,
} from "@marketing-auto/db";
import {
  enqueueBlogGenerationPipeline,
  executeDecision,
  type GenerationMode,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { triggerWithPreRunId } from "../routes/_lib/trigger-helpers.ts";

const log = createLogger("brief-service");

type Project = { id: string };

export type Dispatch = "plan" | "immediate";

export type ApproveBriefResult =
  | { kind: "success"; runId: string; jobId: string }
  | { kind: "plan_queued" }
  | { kind: "cluster_assignment_required" }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: string };

/**
 * Spec 63.6: dispatch-aware brief approval. Default `'plan'` flips pending →
 * plan_pending and lets the Planner pick the brief up at the next cycle (90%
 * Budget-Gate active). `'immediate'` keeps the legacy direct-generate path:
 * create the article row + enqueue article:blog inline.
 *
 * Both branches are idempotent at the CAS level (WHERE approval_status='pending').
 * A second call on the same brief returns `kind: "skipped"`.
 */
export async function approveBrief(
  briefId: string,
  project: Project,
  dispatch: Dispatch = "plan",
): Promise<ApproveBriefResult> {
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, project.id),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .limit(1);

  if (!brief) {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  // create_new briefs require Cluster Creator flow first — applies to both dispatch modes.
  if (brief.clusterAction === "create_new" || !brief.clusterId) {
    return { kind: "cluster_assignment_required" };
  }

  if (dispatch === "plan") {
    return await markBriefPlanPending(briefId, project.id);
  }

  return await approveBriefAndEnqueueImmediate(brief, project);
}

/**
 * Plan-dispatch branch: pending → plan_pending. No article row, no pipeline
 * enqueue. The Planner's `loadPendingTopicBriefs` widens to include plan_pending
 * (Spec 63.6) so the brief lands in the next weekly plan.
 *
 * CAS-guarded on `approval_status='pending'` — concurrent immediate-dispatch on
 * the same brief loses the race and we return `skipped`.
 */
async function markBriefPlanPending(
  briefId: string,
  projectId: string,
): Promise<ApproveBriefResult> {
  const updated = await db
    .update(topicBriefs)
    .set({
      approvalStatus: "plan_pending",
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .returning({ id: topicBriefs.id });

  if (updated.length === 0) {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  log.info({ briefId, projectId }, "brief flipped to plan_pending");
  return { kind: "plan_queued" };
}

/**
 * Immediate-dispatch branch: legacy approveBriefAndEnqueue behaviour — creates
 * the article row via executeDecision (pending → routed inside the transaction)
 * and enqueues article:blog. Bypasses the Planner / Budget-Gate; use sparingly.
 */
async function approveBriefAndEnqueueImmediate(
  brief: typeof topicBriefs.$inferSelect,
  project: Project,
): Promise<ApproveBriefResult> {
  if (!brief.clusterId) {
    // Defensive — approveBrief already gated, but keep the type narrow for executeDecision.
    return { kind: "cluster_assignment_required" };
  }

  const decision: RoutingDecision = {
    kind: "create_article",
    clusterId: brief.clusterId,
    intentType: brief.intentType ?? "general",
    mode: (brief.generationMode ?? "spoke") as GenerationMode,
  };

  const routeResult = await db.transaction(async (tx) => executeDecision(decision, brief, tx));

  if (routeResult.kind === "skipped") {
    return { kind: "skipped", reason: routeResult.reason };
  }
  if (routeResult.kind !== "article_created") {
    return { kind: "error", error: "unexpected_routing_result" };
  }

  const triggerResult = await triggerWithPreRunId({
    pipelineName: "article:blog",
    projectId: project.id,
    uniqueKey: { field: "articleId", value: routeResult.articleId },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
    extraInput: { articleId: routeResult.articleId, briefId: brief.id },
    enqueue: enqueueBlogGenerationPipeline,
  });

  if ("error" in triggerResult) {
    return { kind: "error", error: triggerResult.error };
  }

  log.info(
    { briefId: brief.id, articleId: routeResult.articleId, projectId: project.id, dispatch: "immediate" },
    "brief approved (immediate)",
  );

  return { kind: "success", runId: triggerResult.runId, jobId: triggerResult.jobId };
}

/**
 * Back-compat alias kept for any callers that didn't migrate to `approveBrief`
 * yet. New code should call `approveBrief(id, project, dispatch)`.
 * @deprecated — pass an explicit dispatch via `approveBrief()`.
 */
export async function approveBriefAndEnqueue(
  briefId: string,
  project: Project,
): Promise<ApproveBriefResult> {
  return await approveBrief(briefId, project, "immediate");
}
