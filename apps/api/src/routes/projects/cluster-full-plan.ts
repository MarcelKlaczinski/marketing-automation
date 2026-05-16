import { zValidator } from "@hono/zod-validator";
import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  articles,
  clusters,
  contentPillars,
  cornerstoneSpecs,
  db,
  eq,
  inArray,
  pipelineRuns,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import type { PlanEdit, ProposedHub, ProposedSpoke } from "@marketing-auto/db";
import {
  ProposedHubSchema,
  ProposedSpokeSchema,
  enqueueBlogGenerationPipeline,
  generateClusterPlan,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { voyage } from "@marketing-auto/adapter-voyage";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { triggerWithPreRunId, checkTriggerAllowed, guardErrorToResponse } from "../_lib/trigger-helpers.ts";

const log = createLogger("cluster-full-plan-route");

export const clusterFullPlanRoutes = new Hono();

clusterFullPlanRoutes.use(requireAuth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveProject(slug: string) {
  const [proj] = await db
    .select({
      id: projects.id,
      name: projects.name,
      marketingContextMd: projects.marketingContextMd,
      targetLocales: projects.targetLocales,
      translationAutoTrigger: projects.translationAutoTrigger,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

async function resolveCluster(clusterId: string, projectId: string) {
  const [cluster] = await db
    .select()
    .from(clusters)
    .where(and(eq(clusters.id, clusterId), eq(clusters.projectId, projectId)))
    .limit(1);
  return cluster ?? null;
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

// ─── POST /:slug/clusters/full-plan (Section A) ───────────────────────────────

const fullPlanBodySchema = z.object({
  triggerBriefId: z.string().uuid(),
});

clusterFullPlanRoutes.post(
  "/:slug/clusters/full-plan",
  zValidator("json", fullPlanBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const { triggerBriefId } = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    // Validate brief
    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(and(eq(topicBriefs.id, triggerBriefId), eq(topicBriefs.projectId, proj.id)))
      .limit(1);

    if (!brief) return c.json({ ok: false, error: "Brief not found" }, 404);
    if (brief.source !== "trend_discovery") {
      return c.json({ ok: false, error: "Brief must be from trend_discovery source" }, 400);
    }
    if (brief.approvalStatus !== "pending") {
      return c.json({ ok: false, error: "Brief is no longer pending" }, 400);
    }

    // Cost guard (just cluster plan LLM — downstream article costs checked at approve)
    const blocked = await checkTriggerAllowed({
      pipelineName: "cluster:full-plan",
      projectId: proj.id,
      uniqueKey: { field: "triggerBriefId", value: triggerBriefId },
      costEstimate: { service: "anthropic", estimatedCostEur: 0.40 },
    });
    if (blocked && "error" in blocked) return guardErrorToResponse(c, blocked);
    if (blocked && "deduped" in blocked && blocked.deduped) {
      // Brief already being processed — return the existing cluster
      const [existingCluster] = await db
        .select({ id: clusters.id, generationStatus: clusters.generationStatus, proposedHub: clusters.proposedHub, proposedSpokes: clusters.proposedSpokes })
        .from(clusters)
        .where(and(eq(clusters.projectId, proj.id), eq(clusters.triggerBriefId, triggerBriefId)))
        .limit(1);
      if (existingCluster) {
        return c.json({ ok: true, data: existingCluster, deduped: true }, 200);
      }
    }

    // Load context for LLM prompt
    const [existingPillars, existingClusters] = await Promise.all([
      db.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(eq(contentPillars.projectId, proj.id)),
      db.select({ id: clusters.id, name: clusters.name }).from(clusters).where(eq(clusters.projectId, proj.id)).limit(20),
    ]);

    // Compute cluster embedding BEFORE transaction (external API call)
    const embeddingText = `${brief.topicTitle} ${brief.primaryKeyword ?? ""}`.trim();
    let clusterEmbedding: number[] = [];
    try {
      clusterEmbedding = await voyage.embed(embeddingText, {
        projectId: proj.id,
        operation: "cluster-full-plan-embed",
      });
    } catch (e) {
      log.warn({ err: e, projectId: proj.id }, "failed to compute cluster embedding — proceeding without");
    }

    // Call LLM
    let plan: Awaited<ReturnType<typeof generateClusterPlan>>;
    try {
      plan = await generateClusterPlan({
        triggerBrief: brief,
        projectId: proj.id,
        projectName: proj.name,
        projectMarketingContextMd: proj.marketingContextMd ?? null,
        existingPillars,
        existingClusters,
      });
    } catch (err) {
      log.error({ err, projectId: proj.id, briefId: triggerBriefId }, "cluster plan LLM failed");
      return c.json({ ok: false, error: "Cluster plan generation failed" }, 500);
    }

    // Atomic cluster creation
    type TxResult = { clusterId: string; pillarId: string };
    let txResult: TxResult;
    try {
      txResult = await db.transaction(async (tx) => {
        // Re-verify brief is still pending inside transaction
        const [freshBrief] = await tx
          .select({ id: topicBriefs.id, approvalStatus: topicBriefs.approvalStatus })
          .from(topicBriefs)
          .where(and(eq(topicBriefs.id, triggerBriefId), eq(topicBriefs.projectId, proj.id), eq(topicBriefs.approvalStatus, "pending")))
          .limit(1);
        if (!freshBrief) throw new Error("Brief no longer pending");

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

        // Resolve pillar name for denormalized field
        const [pillarRow] = await tx
          .select({ name: contentPillars.name })
          .from(contentPillars)
          .where(eq(contentPillars.id, pillarId))
          .limit(1);
        const pillarName = pillarRow?.name ?? plan.cluster.name;

        // Create cluster
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
            triggerBriefId,
            proposedSpokes: plan.spokes as ProposedSpoke[],
            proposedHub: plan.hub as ProposedHub,
            planEdits: [],
          })
          .returning({ id: clusters.id });
        if (!newCluster) throw new Error("Failed to insert cluster");

        // Write embedding via raw SQL (vector type requires ::vector cast)
        if (clusterEmbedding.length > 0) {
          await tx.execute(sql`
            UPDATE clusters
            SET embedding = ${JSON.stringify(clusterEmbedding)}::vector
            WHERE id = ${newCluster.id}
          `);
        }

        // Mark trigger brief as routed → cluster
        await tx
          .update(topicBriefs)
          .set({ approvalStatus: "routed", approvedAt: new Date(), routedClusterId: newCluster.id, updatedAt: new Date() })
          .where(eq(topicBriefs.id, triggerBriefId));

        return { clusterId: newCluster.id, pillarId };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      log.error({ err, projectId: proj.id, briefId: triggerBriefId }, message);
      return c.json({ ok: false, error: message }, 400);
    }

    log.info(
      { projectId: proj.id, clusterId: txResult.clusterId, briefId: triggerBriefId, spokeCount: plan.spokes.length },
      "cluster full-plan created",
    );

    return c.json(
      {
        ok: true,
        data: {
          clusterId: txResult.clusterId,
          pillarId: txResult.pillarId,
          cluster: plan.cluster,
          hub: plan.hub,
          spokes: plan.spokes,
          generationStatus: "plan_proposed",
        },
      },
      201,
    );
  },
);

// ─── GET /:slug/clusters/:id/plan (Section B) ─────────────────────────────────

clusterFullPlanRoutes.get("/:slug/clusters/:id/plan", async (c) => {
  const slug = c.req.param("slug");
  const clusterId = c.req.param("id");

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const cluster = await resolveCluster(clusterId, proj.id);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  return c.json({
    ok: true,
    data: {
      clusterId: cluster.id,
      name: cluster.name,
      primaryKeyword: cluster.primaryKeyword,
      generationStatus: cluster.generationStatus,
      hub: cluster.proposedHub,
      spokes: cluster.proposedSpokes ?? [],
      planEdits: cluster.planEdits ?? [],
    },
  });
});

// ─── PATCH /:slug/clusters/:id/plan/spokes/:spokeIndex (Section B) ───────────

const patchSpokeBodySchema = z.object({
  proposedTitle: z.string().min(10).max(200).optional(),
  primaryKeyword: z.string().min(3).max(100).optional(),
  intentType: z
    .enum(["review", "comparison", "pricing", "tutorial", "use-cases", "features"])
    .optional(),
  estimatedWordCount: z.number().int().min(500).max(5000).optional(),
  rationale: z.string().min(10).max(500).optional(),
});

clusterFullPlanRoutes.patch(
  "/:slug/clusters/:id/plan/spokes/:spokeIndex",
  zValidator("json", patchSpokeBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const clusterId = c.req.param("id");
    const spokeIndex = Number(c.req.param("spokeIndex"));
    const patch = c.req.valid("json");

    if (!Number.isInteger(spokeIndex) || spokeIndex < 0) {
      return c.json({ ok: false, error: "Invalid spoke index" }, 400);
    }

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const cluster = await resolveCluster(clusterId, proj.id);
    if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

    if (cluster.generationStatus !== "plan_proposed") {
      return c.json({ ok: false, error: "Plan can only be edited when generationStatus=plan_proposed" }, 400);
    }

    const spokes = (cluster.proposedSpokes ?? []) as ProposedSpoke[];
    if (spokeIndex >= spokes.length) {
      return c.json({ ok: false, error: `Spoke index ${spokeIndex} out of range (${spokes.length} spokes)` }, 400);
    }

    const before = spokes[spokeIndex]!;
    const updated: ProposedSpoke = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<ProposedSpoke> };

    // Validate the patched spoke
    const parseResult = ProposedSpokeSchema.safeParse(updated);
    if (!parseResult.success) {
      return c.json({ ok: false, error: parseResult.error.message }, 400);
    }

    const newSpokes = spokes.map((s, i) => (i === spokeIndex ? updated : s));

    // Uniqueness check: intentType must remain distinct
    const intentTypes = newSpokes.map((s) => s.intentType);
    if (new Set(intentTypes).size !== intentTypes.length) {
      return c.json({ ok: false, error: "Each spoke must have a distinct intentType" }, 400);
    }

    const edit: PlanEdit = {
      timestamp: new Date().toISOString(),
      action: "patch_spoke",
      spokeIndex,
      before,
      after: updated,
    };

    await db
      .update(clusters)
      .set({
        proposedSpokes: newSpokes,
        planEdits: [...(cluster.planEdits ?? []), edit],
      })
      .where(eq(clusters.id, clusterId));

    return c.json({ ok: true, data: { spoke: updated, spokeIndex } });
  },
);

// ─── DELETE /:slug/clusters/:id/plan/spokes/:spokeIndex (Section B) ──────────

clusterFullPlanRoutes.delete("/:slug/clusters/:id/plan/spokes/:spokeIndex", async (c) => {
  const slug = c.req.param("slug");
  const clusterId = c.req.param("id");
  const spokeIndex = Number(c.req.param("spokeIndex"));

  if (!Number.isInteger(spokeIndex) || spokeIndex < 0) {
    return c.json({ ok: false, error: "Invalid spoke index" }, 400);
  }

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const cluster = await resolveCluster(clusterId, proj.id);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  if (cluster.generationStatus !== "plan_proposed") {
    return c.json({ ok: false, error: "Plan can only be edited when generationStatus=plan_proposed" }, 400);
  }

  const spokes = (cluster.proposedSpokes ?? []) as ProposedSpoke[];
  if (spokeIndex >= spokes.length) {
    return c.json({ ok: false, error: `Spoke index ${spokeIndex} out of range (${spokes.length} spokes)` }, 400);
  }

  if (spokes.length <= 4) {
    return c.json({ ok: false, error: "Cannot delete: minimum 4 spokes required" }, 400);
  }

  const before = spokes[spokeIndex]!;
  const newSpokes = spokes.filter((_, i) => i !== spokeIndex).map((s, i) => ({ ...s, position: i }));

  const edit: PlanEdit = {
    timestamp: new Date().toISOString(),
    action: "delete_spoke",
    spokeIndex,
    before,
  };

  await db
    .update(clusters)
    .set({
      proposedSpokes: newSpokes,
      planEdits: [...(cluster.planEdits ?? []), edit],
    })
    .where(eq(clusters.id, clusterId));

  return c.json({ ok: true, data: { deletedIndex: spokeIndex, remainingCount: newSpokes.length } });
});

// ─── PATCH /:slug/clusters/:id/plan/hub (Section B) ──────────────────────────

const patchHubBodySchema = z.object({
  title: z.string().min(10).max(200).optional(),
  primaryKeyword: z.string().min(3).max(100).optional(),
  intentType: z.enum(["overview", "general"]).optional(),
  estimatedWordCount: z.number().int().min(800).max(5000).optional(),
  h2Outline: z.array(z.string().min(3).max(150)).min(4).max(10).optional(),
  metaDescription: z.string().max(160).optional(),
});

clusterFullPlanRoutes.patch(
  "/:slug/clusters/:id/plan/hub",
  zValidator("json", patchHubBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const clusterId = c.req.param("id");
    const patch = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const cluster = await resolveCluster(clusterId, proj.id);
    if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

    if (cluster.generationStatus !== "plan_proposed") {
      return c.json({ ok: false, error: "Plan can only be edited when generationStatus=plan_proposed" }, 400);
    }

    if (!cluster.proposedHub) {
      return c.json({ ok: false, error: "No proposed hub found on cluster" }, 400);
    }

    const before = cluster.proposedHub as ProposedHub;
    const updated: ProposedHub = {
      ...before,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<ProposedHub>,
    };

    // Validate the patched hub
    const parseResult = ProposedHubSchema.safeParse(updated);
    if (!parseResult.success) {
      return c.json({ ok: false, error: parseResult.error.message }, 400);
    }

    const edit: PlanEdit = {
      timestamp: new Date().toISOString(),
      action: "patch_hub",
      before,
      after: updated,
    };

    await db
      .update(clusters)
      .set({
        proposedHub: updated,
        planEdits: [...(cluster.planEdits ?? []), edit],
      })
      .where(eq(clusters.id, clusterId));

    return c.json({ ok: true, data: { hub: updated } });
  },
);

// ─── POST /:slug/clusters/:id/plan/regenerate (Section B) ────────────────────

const regenerateBodySchema = z.object({
  refinementHint: z.string().min(5).max(500).optional(),
});

clusterFullPlanRoutes.post(
  "/:slug/clusters/:id/plan/regenerate",
  zValidator("json", regenerateBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const clusterId = c.req.param("id");
    const { refinementHint } = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const cluster = await resolveCluster(clusterId, proj.id);
    if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

    if (cluster.generationStatus !== "plan_proposed") {
      return c.json({ ok: false, error: "Can only regenerate when generationStatus=plan_proposed" }, 400);
    }

    if (!cluster.triggerBriefId) {
      return c.json({ ok: false, error: "Cluster has no trigger brief — cannot regenerate" }, 400);
    }

    // Load trigger brief (already routed, but we still use its content)
    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, cluster.triggerBriefId))
      .limit(1);
    if (!brief) return c.json({ ok: false, error: "Trigger brief not found" }, 404);

    // Load context
    const [existingPillars, existingClusters] = await Promise.all([
      db.select({ id: contentPillars.id, name: contentPillars.name }).from(contentPillars).where(eq(contentPillars.projectId, proj.id)),
      db.select({ id: clusters.id, name: clusters.name }).from(clusters).where(eq(clusters.projectId, proj.id)).limit(20),
    ]);

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
        { ...(refinementHint !== undefined && { refinementHint }) },
      );
    } catch (err) {
      log.error({ err, projectId: proj.id, clusterId }, "cluster plan regeneration LLM failed");
      return c.json({ ok: false, error: "Cluster plan regeneration failed" }, 500);
    }

    const edit: PlanEdit = {
      timestamp: new Date().toISOString(),
      action: "regenerate",
      ...(refinementHint !== undefined && { hint: refinementHint }),
    };

    await db
      .update(clusters)
      .set({
        proposedHub: plan.hub as ProposedHub,
        proposedSpokes: plan.spokes as ProposedSpoke[],
        planEdits: [...(cluster.planEdits ?? []), edit],
      })
      .where(eq(clusters.id, clusterId));

    return c.json({
      ok: true,
      data: {
        hub: plan.hub,
        spokes: plan.spokes,
      },
    });
  },
);

// ─── GET /:slug/clusters/:id/plan/cost-estimate (Section F) ──────────────────

clusterFullPlanRoutes.get("/:slug/clusters/:id/plan/cost-estimate", async (c) => {
  const slug = c.req.param("slug");
  const clusterId = c.req.param("id");

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const cluster = await resolveCluster(clusterId, proj.id);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  const spokeCount = (cluster.proposedSpokes ?? []).length;
  const articleCount = 1 + spokeCount;
  const hasTranslation =
    (proj.targetLocales ?? []).includes("en-US") && proj.translationAutoTrigger !== false;
  const totalArticleCount = hasTranslation ? articleCount * 2 : articleCount;

  const costBreakdown = {
    clusterPlanLLM: 0.40,
    hubGeneration: 0.39,
    spokesGeneration: 0.39 * spokeCount,
    translations: hasTranslation ? 0.21 * articleCount : 0,
  };
  const totalEstimateEur =
    costBreakdown.clusterPlanLLM +
    costBreakdown.hubGeneration +
    costBreakdown.spokesGeneration +
    costBreakdown.translations;

  return c.json({
    ok: true,
    data: {
      articleCount,
      totalArticleCount,
      costBreakdown,
      totalEstimateEur,
      wallClockMinEstimate: 10,
      wallClockMaxEstimate: 20,
    },
  });
});

// ─── POST /:slug/clusters/:id/plan/approve (Section C) ───────────────────────

clusterFullPlanRoutes.post("/:slug/clusters/:id/plan/approve", async (c) => {
  const slug = c.req.param("slug");
  const clusterId = c.req.param("id");

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const cluster = await resolveCluster(clusterId, proj.id);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  if (cluster.generationStatus !== "plan_proposed") {
    return c.json(
      { ok: false, error: `Cannot approve: generationStatus is '${cluster.generationStatus}' (expected 'plan_proposed')` },
      400,
    );
  }

  const hub = cluster.proposedHub as ProposedHub | null;
  const spokes = (cluster.proposedSpokes ?? []) as ProposedSpoke[];

  if (!hub) return c.json({ ok: false, error: "No proposed hub found on cluster" }, 400);
  if (spokes.length < 4) return c.json({ ok: false, error: "At least 4 spokes required to approve" }, 400);

  // Cost guard for the full generation (hub + spokes)
  const totalCostEur = 0.39 + 0.39 * spokes.length;
  const costGuard = await checkTriggerAllowed({
    pipelineName: "article:blog",
    projectId: proj.id,
    uniqueKey: { field: "clusterGenerationId", value: clusterId },
    costEstimate: { service: "anthropic", estimatedCostEur: totalCostEur },
  });
  if (costGuard && "error" in costGuard) return guardErrorToResponse(c, costGuard);

  type ApproveResult = {
    hubBriefId: string;
    hubArticleId: string;
    spokeBriefIds: string[];
    cornerstoneSpecId: string;
  };

  let result: ApproveResult;
  try {
    result = await db.transaction(async (tx) => {
      // Idempotency: re-check status inside transaction
      const [freshCluster] = await tx
        .select({ generationStatus: clusters.generationStatus })
        .from(clusters)
        .where(and(eq(clusters.id, clusterId), eq(clusters.projectId, proj.id)))
        .limit(1);
      if (freshCluster?.generationStatus !== "plan_proposed") {
        throw new Error("Cluster status changed concurrently — already approved");
      }

      // Create hub brief
      const hubSlug = toSlug(hub.title);
      const [hubBrief] = await tx
        .insert(topicBriefs)
        .values({
          projectId: proj.id,
          source: "trend_discovery",
          topicTitle: hub.title,
          primaryKeyword: hub.primaryKeyword,
          secondaryKeywords: [],
          locale: "de",
          intentType: hub.intentType,
          clusterId,
          clusterAction: "append_to_existing",
          approvalStatus: "approved",
          approvedAt: new Date(),
          suggestedTitle: hub.title,
          suggestedSlug: hubSlug,
          suggestedMeta: hub.metaDescription ?? null,
          approvalRequired: false,
        })
        .returning({ id: topicBriefs.id });
      if (!hubBrief) throw new Error("Failed to insert hub brief");

      // Create hub article (pre-created so triggerWithPreRunId can use articleId as uniqueKey)
      const [hubArticle] = await tx
        .insert(articles)
        .values({
          projectId: proj.id,
          clusterId,
          slug: hubSlug,
          title: hub.title,
          metaDescription: hub.metaDescription ?? null,
          cornerstoneKeyword: hub.primaryKeyword,
          locale: "de",
          source: "generated",
          collection: "blog",
          intentType: hub.intentType,
          status: "proposed",
          approvalMode: "manual",
          clusterGenerationId: clusterId,
          role: "hub",
          translationKey: crypto.randomUUID(),
        })
        .returning({ id: articles.id });
      if (!hubArticle) throw new Error("Failed to insert hub article");

      // Link hub brief → article
      await tx
        .update(topicBriefs)
        .set({ routedArticleId: hubArticle.id, updatedAt: new Date() })
        .where(eq(topicBriefs.id, hubBrief.id));

      // Create cornerstone spec for hub
      const [cornerstoneSpec] = await tx
        .insert(cornerstoneSpecs)
        .values({
          projectId: proj.id,
          clusterId,
          locale: "de",
          translationKey: crypto.randomUUID(),
          cornerstoneKeyword: hub.primaryKeyword,
          proposedTitle: hub.title,
          proposedSlug: hubSlug,
          metaDescription: hub.metaDescription ?? "",
          h2Outline: hub.h2Outline,
          estimatedWordCount: hub.estimatedWordCount,
          status: "approved",
        })
        .returning({ id: cornerstoneSpecs.id });
      if (!cornerstoneSpec) throw new Error("Failed to insert cornerstone spec");

      // Create spoke briefs (no articles yet — created at enqueue time by enqueueBlogGeneration)
      const spokeBriefIds: string[] = [];
      for (const spoke of spokes) {
        const [spokeBrief] = await tx
          .insert(topicBriefs)
          .values({
            projectId: proj.id,
            source: "trend_discovery",
            topicTitle: spoke.proposedTitle,
            primaryKeyword: spoke.primaryKeyword,
            secondaryKeywords: [],
            locale: "de",
            intentType: spoke.intentType,
            clusterId,
            clusterAction: "append_to_existing",
            approvalStatus: "approved",
            approvedAt: new Date(),
            suggestedTitle: spoke.proposedTitle,
            suggestedSlug: toSlug(spoke.proposedTitle),
            suggestedMeta: null,
            approvalRequired: false,
          })
          .returning({ id: topicBriefs.id });
        if (!spokeBrief) throw new Error("Failed to insert spoke brief");
        spokeBriefIds.push(spokeBrief.id);
      }

      // Update cluster: running + store pending spoke brief IDs
      await tx
        .update(clusters)
        .set({
          generationStatus: "running",
          status: "active",
          pendingSpokeBriefIds: spokeBriefIds,
        })
        .where(eq(clusters.id, clusterId));

      return {
        hubBriefId: hubBrief.id,
        hubArticleId: hubArticle.id,
        spokeBriefIds,
        cornerstoneSpecId: cornerstoneSpec.id,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval transaction failed";
    log.error({ err, projectId: proj.id, clusterId }, message);
    return c.json({ ok: false, error: message }, 400);
  }

  // Enqueue hub blog pipeline (outside transaction — BullMQ call)
  const triggerResult = await triggerWithPreRunId({
    pipelineName: "article:blog",
    projectId: proj.id,
    uniqueKey: { field: "articleId", value: result.hubArticleId },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
    extraInput: { articleId: result.hubArticleId, briefId: result.hubBriefId },
    enqueue: enqueueBlogGenerationPipeline,
  });

  if ("error" in triggerResult) {
    log.warn({ err: triggerResult.error, projectId: proj.id, clusterId }, "hub pipeline trigger failed after cluster approval");
    return c.json(
      {
        ok: true,
        data: {
          clusterId,
          hubBriefId: result.hubBriefId,
          hubArticleId: result.hubArticleId,
          spokeBriefIds: result.spokeBriefIds,
          cornerstoneSpecId: result.cornerstoneSpecId,
          generationStatus: "running",
          pipelineWarning: triggerResult.error,
        },
      },
      202,
    );
  }

  log.info(
    {
      projectId: proj.id,
      clusterId,
      hubArticleId: result.hubArticleId,
      spokeCount: spokes.length,
      runId: triggerResult.runId,
    },
    "cluster approved — hub pipeline enqueued",
  );

  return c.json(
    {
      ok: true,
      data: {
        clusterId,
        hubBriefId: result.hubBriefId,
        hubArticleId: result.hubArticleId,
        spokeBriefIds: result.spokeBriefIds,
        cornerstoneSpecId: result.cornerstoneSpecId,
        generationStatus: "running",
        runId: triggerResult.runId,
        jobId: triggerResult.jobId,
        deduped: triggerResult.deduped,
      },
    },
    triggerResult.deduped ? 200 : 202,
  );
});

// ─── POST /:slug/clusters/:id/retry-failed-spokes (Section D) ────────────────

clusterFullPlanRoutes.post("/:slug/clusters/:id/retry-failed-spokes", async (c) => {
  const slug = c.req.param("slug");
  const clusterId = c.req.param("id");

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const cluster = await resolveCluster(clusterId, proj.id);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  if (cluster.generationStatus !== "partial") {
    return c.json(
      { ok: false, error: `Cannot retry: generationStatus is '${cluster.generationStatus}' (expected 'partial')` },
      400,
    );
  }

  // Find failed pipeline runs for this cluster
  const failedRuns = await db
    .select({ id: pipelineRuns.id, input: pipelineRuns.input })
    .from(pipelineRuns)
    .where(
      and(
        sql`${pipelineRuns.input}->>'clusterGenerationId' = ${clusterId}`,
        eq(pipelineRuns.status, "failed"),
      ),
    );

  const briefIdsToRetry = failedRuns
    .map((r) => {
      const input = r.input as Record<string, unknown>;
      return typeof input["briefId"] === "string" ? input["briefId"] : null;
    })
    .filter((id): id is string => id !== null);

  if (briefIdsToRetry.length === 0) {
    return c.json({ ok: false, error: "No failed spoke runs found for this cluster" }, 400);
  }

  // Load briefs to get article IDs
  const spokeBriefs = await db
    .select({ id: topicBriefs.id, routedArticleId: topicBriefs.routedArticleId })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, proj.id),
        inArray(topicBriefs.id, briefIdsToRetry),
      ),
    );

  // Enqueue only briefs that already have an article created
  const enqueued: string[] = [];
  for (const brief of spokeBriefs) {
    if (!brief.routedArticleId) continue;
    const triggerResult = await triggerWithPreRunId({
      pipelineName: "article:blog",
      projectId: proj.id,
      uniqueKey: { field: "articleId", value: brief.routedArticleId },
      costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
      extraInput: { articleId: brief.routedArticleId, briefId: brief.id },
      enqueue: enqueueBlogGenerationPipeline,
    });
    if (!("error" in triggerResult)) {
      enqueued.push(brief.routedArticleId);
    }
  }

  // Reset cluster status to running
  await db
    .update(clusters)
    .set({ generationStatus: "running" })
    .where(eq(clusters.id, clusterId));

  log.info({ projectId: proj.id, clusterId, retriedCount: enqueued.length }, "retried failed spokes");

  return c.json({
    ok: true,
    data: {
      retriedBriefCount: briefIdsToRetry.length,
      enqueuedArticleIds: enqueued,
      generationStatus: "running",
    },
  });
});
