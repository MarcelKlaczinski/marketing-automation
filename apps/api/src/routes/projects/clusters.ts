import { zValidator } from "@hono/zod-validator";
import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  clusters,
  contentPillars,
  cornerstoneSpecs,
  db,
  eq,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import {
  ClusterProposalSchema,
  enqueueArticleOutlinePipeline,
  executeDecision,
  loadActiveConfig,
  proposeCluster,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { voyage } from "@marketing-auto/adapter-voyage";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { triggerWithPreRunId } from "../_lib/trigger-helpers.ts";

const log = createLogger("cluster-creator-route");

export const clusterCreatorRoutes = new Hono();

clusterCreatorRoutes.use(requireAuth);

// ─── Helper: resolve project by slug ─────────────────────────────────────────

async function resolveProject(slug: string): Promise<{ id: string; name: string } | null> {
  const [proj] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// ─── POST /:slug/clusters/propose ────────────────────────────────────────────

const proposeBodySchema = z.object({
  fromBriefId: z.string().uuid(),
});

clusterCreatorRoutes.post(
  "/:slug/clusters/propose",
  zValidator("json", proposeBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const { fromBriefId } = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(
        and(
          eq(topicBriefs.id, fromBriefId),
          eq(topicBriefs.projectId, proj.id),
        ),
      )
      .limit(1);

    if (!brief) return c.json({ ok: false, error: "Brief not found" }, 404);
    if (brief.clusterAction !== "create_new") {
      return c.json({ ok: false, error: "Brief does not have cluster_action=create_new" }, 400);
    }
    if (brief.approvalStatus !== "pending") {
      return c.json({ ok: false, error: "Brief is no longer pending" }, 400);
    }

    const proposal = await proposeCluster({ projectId: proj.id, brief });

    log.info({ projectId: proj.id, briefId: fromBriefId, clusterName: proposal.cluster_name }, "cluster proposed");

    return c.json({ ok: true, data: { proposal } });
  },
);

// ─── POST /:slug/clusters/create-from-brief ──────────────────────────────────

const createFromBriefBodySchema = z.object({
  fromBriefId: z.string().uuid(),
  proposal: ClusterProposalSchema,
  generateMode: z.enum(["queue", "now"]).default("queue"),
});

clusterCreatorRoutes.post(
  "/:slug/clusters/create-from-brief",
  zValidator("json", createFromBriefBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    // Load project config for locale — needed for cornerstoneSpecs.locale
    const config = await loadActiveConfig(proj.id);
    const primaryLocale = config.topicScope.languages[0] ?? "de";

    // Compute embedding BEFORE opening the transaction (external API call)
    const embeddingText = `${body.proposal.cluster_name} ${body.proposal.primary_keyword}`.trim();
    let clusterEmbedding: number[];
    try {
      clusterEmbedding = await voyage.embed(embeddingText, {
        projectId: proj.id,
        operation: "cluster-create-embed",
      });
    } catch (e) {
      log.warn({ err: e, projectId: proj.id }, "failed to compute cluster embedding — proceeding without");
      clusterEmbedding = [];
    }

    type TxResult = {
      clusterId: string;
      pillarId: string;
      cornerstoneSpecId: string;
      routingResult: Awaited<ReturnType<typeof executeDecision>>;
      articleId: string | null;
    };

    let txResult: TxResult;
    try {
      txResult = await db.transaction(async (tx) => {
        // 1. Re-verify brief is still pending inside the transaction
        const [brief] = await tx
          .select()
          .from(topicBriefs)
          .where(
            and(
              eq(topicBriefs.id, body.fromBriefId),
              eq(topicBriefs.projectId, proj.id),
              eq(topicBriefs.approvalStatus, "pending"),
            ),
          )
          .limit(1);

        if (!brief) throw new Error("Brief no longer pending or not found");

        // 2. Create contentPillars row (clusters require a pillar)
        const [newPillar] = await tx
          .insert(contentPillars)
          .values({
            projectId: proj.id,
            name: body.proposal.cluster_name,
            description: body.proposal.description,
            intentTaxonomyOverride: body.proposal.intent_taxonomy_override,
          })
          .returning({ id: contentPillars.id });
        if (!newPillar) throw new Error("Failed to insert content pillar");

        // 3. Create clusters row (without embedding first — raw SQL needed for vector)
        const [newCluster] = await tx
          .insert(clusters)
          .values({
            projectId: proj.id,
            pillarId: newPillar.id,
            name: body.proposal.cluster_name,
            pillar: body.proposal.cluster_name,
            primaryKeyword: body.proposal.primary_keyword,
            status: "proposed",
          })
          .returning({ id: clusters.id });
        if (!newCluster) throw new Error("Failed to insert cluster");

        // 4. Write embedding via raw SQL (vector type requires ::vector cast)
        if (clusterEmbedding.length > 0) {
          await tx.execute(sql`
            UPDATE clusters
            SET embedding = ${JSON.stringify(clusterEmbedding)}::vector
            WHERE id = ${newCluster.id}
          `);
        }

        // 5. Create cornerstone_specs row
        const [newSpec] = await tx
          .insert(cornerstoneSpecs)
          .values({
            projectId: proj.id,
            clusterId: newCluster.id,
            locale: primaryLocale,
            translationKey: crypto.randomUUID(),
            cornerstoneKeyword: body.proposal.primary_keyword,
            proposedTitle: body.proposal.pillar_title,
            proposedSlug: body.proposal.pillar_slug,
            metaDescription: body.proposal.pillar_meta,
            h2Outline: body.proposal.pillar_outline,
            estimatedWordCount: 2000,
            status: "proposed",
          })
          .returning({ id: cornerstoneSpecs.id });
        if (!newSpec) throw new Error("Failed to insert cornerstone spec");

        // 6. Update brief: approve + link cluster + set intent type
        await tx
          .update(topicBriefs)
          .set({
            approvalStatus: "approved",
            clusterId: newCluster.id,
            intentType: body.proposal.spoke_intent_for_originating_brief,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(topicBriefs.id, brief.id));

        // 7. Route the spoke article via executeDecision
        const updatedBrief = {
          ...brief,
          clusterId: newCluster.id,
          intentType: body.proposal.spoke_intent_for_originating_brief,
          approvalStatus: "approved" as const,
        };

        const decision: RoutingDecision = {
          kind: "create_article",
          clusterId: newCluster.id,
          intentType: body.proposal.spoke_intent_for_originating_brief,
          mode: "spoke",
        };

        const routingResult = await executeDecision(decision, updatedBrief, tx);

        const articleId =
          routingResult.kind === "article_created" ? routingResult.articleId : null;

        return {
          clusterId: newCluster.id,
          pillarId: newPillar.id,
          cornerstoneSpecId: newSpec.id,
          routingResult,
          articleId,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      log.error({ err, projectId: proj.id, fromBriefId: body.fromBriefId }, message);
      return c.json({ ok: false, error: message }, 400);
    }

    if (!txResult.articleId) {
      return c.json({ ok: false, error: "Failed to create spoke article" }, 500);
    }

    // 8. Enqueue the article outline pipeline
    const triggerResult = await triggerWithPreRunId({
      pipelineName: "article:outline",
      projectId: proj.id,
      uniqueKey: { field: "articleId", value: txResult.articleId },
      costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
      extraInput: { articleId: txResult.articleId },
      enqueue: enqueueArticleOutlinePipeline,
    });

    if ("error" in triggerResult) {
      log.warn({ err: triggerResult.error, projectId: proj.id }, "pipeline trigger failed after cluster creation");
      // Cluster and brief are already created — return success with warning
      return c.json(
        {
          ok: true,
          data: {
            clusterId: txResult.clusterId,
            pillarId: txResult.pillarId,
            cornerstoneSpecId: txResult.cornerstoneSpecId,
            articleId: txResult.articleId,
            briefStatus: "approved",
            pipelineWarning: triggerResult.error,
          },
        },
        202,
      );
    }

    log.info(
      {
        projectId: proj.id,
        clusterId: txResult.clusterId,
        articleId: txResult.articleId,
        runId: triggerResult.runId,
      },
      "cluster created and article queued",
    );

    return c.json(
      {
        ok: true,
        data: {
          clusterId: txResult.clusterId,
          pillarId: txResult.pillarId,
          cornerstoneSpecId: txResult.cornerstoneSpecId,
          articleId: txResult.articleId,
          briefStatus: "approved",
          runId: triggerResult.runId,
          jobId: triggerResult.jobId,
          deduped: triggerResult.deduped,
        },
      },
      triggerResult.deduped ? 200 : 202,
    );
  },
);
