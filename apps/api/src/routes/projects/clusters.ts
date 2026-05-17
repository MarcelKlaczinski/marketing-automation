import { zValidator } from "@hono/zod-validator";
import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  articles,
  asc,
  type ClusterGenerationStatus,
  clusters,
  contentPillars,
  cornerstoneSpecs,
  costLogs,
  db,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  or,
  pipelineRuns,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import {
  ClusterProposalSchema,
  enqueueArticleOutlinePipeline,
  enqueueBlogGenerationPipeline,
  executeDecision,
  loadActiveConfig,
  proposeCluster,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { voyage } from "@marketing-auto/adapter-voyage";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../../lib/pagination.ts";
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

    const [proposal, config] = await Promise.all([
      proposeCluster({ projectId: proj.id, brief }),
      loadActiveConfig(proj.id), // 60s in-process cache — effectively free after proposeCluster warms it
    ]);

    log.info({ projectId: proj.id, briefId: fromBriefId, clusterName: proposal.cluster_name }, "cluster proposed");

    return c.json({
      ok: true,
      data: { proposal, projectDefaultIntents: config.intentTaxonomyDefault ?? [] },
    });
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
      briefId: string;
      briefLocale: string | null;
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

        // 6. Update brief: approve + link cluster + set intent type + fix clusterAction
        await tx
          .update(topicBriefs)
          .set({
            approvalStatus: "approved",
            clusterId: newCluster.id,
            clusterAction: "append_to_existing",
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
          briefId: brief.id,
          briefLocale: brief.locale,
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

    // 8. Enqueue pipeline — blog for trend briefs (locale set), outline for gap/manual briefs
    const isBlogBrief = txResult.briefLocale !== null;
    const triggerResult = await triggerWithPreRunId(
      isBlogBrief
        ? {
            pipelineName: "article:blog",
            projectId: proj.id,
            uniqueKey: { field: "articleId", value: txResult.articleId },
            costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
            extraInput: { articleId: txResult.articleId, briefId: txResult.briefId },
            enqueue: enqueueBlogGenerationPipeline,
          }
        : {
            pipelineName: "article:outline",
            projectId: proj.id,
            uniqueKey: { field: "articleId", value: txResult.articleId },
            costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
            extraInput: { articleId: txResult.articleId },
            enqueue: enqueueArticleOutlinePipeline,
          },
    );

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

// ─── GET /:slug/clusters/:id/generation-status ────────────────────────────────
clusterCreatorRoutes.get("/:slug/clusters/:id/generation-status", async (c) => {
  const { slug, id } = c.req.param();

  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [cluster] = await db
    .select()
    .from(clusters)
    .where(and(eq(clusters.id, id), eq(clusters.projectId, project.id)))
    .limit(1);

  if (!cluster) return c.json({ ok: false, error: "cluster_not_found" }, 404);

  // Load all articles tied to this cluster (by generation batch OR manually-added)
  const clusterArticles = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      status: articles.status,
      locale: articles.locale,
      role: articles.role,
      heroImagePublicUrl: articles.heroImagePublicUrl,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .where(or(eq(articles.clusterGenerationId, id), eq(articles.clusterId, id)))
    .orderBy(asc(articles.createdAt));

  // Load pipeline_runs tied to this cluster generation
  const pipelineRunsForCluster = await db
    .select({
      id: pipelineRuns.id,
      pipelineName: pipelineRuns.pipelineName,
      status: pipelineRuns.status,
      input: pipelineRuns.input,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .where(sql`${pipelineRuns.input}->>'clusterGenerationId' = ${id}`)
    .orderBy(desc(pipelineRuns.createdAt));

  // Aggregate cost across all runs for this cluster generation
  const runIds = pipelineRunsForCluster.map((r) => r.id);
  const totalCostEur =
    runIds.length > 0
      ? await db
          .select({ total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)` })
          .from(costLogs)
          .where(inArray(costLogs.pipelineRunId, runIds))
          .then((r) => Number(r[0]?.total ?? 0))
      : 0;

  const hubArticle = clusterArticles.find((a) => a.role === "hub") ?? null;
  const spokeArticles = clusterArticles.filter((a) => a.role === "spoke");

  // Progress: count articles at or past final_review
  const completedCount = clusterArticles.filter(
    (a) => a.status === "final_review" || a.status === "published",
  ).length;
  const expectedCount = 1 + (cluster.proposedSpokes?.length ?? 0);
  const progressPercent =
    expectedCount > 0 ? Math.round((completedCount / expectedCount) * 100) : 0;

  return c.json({
    ok: true,
    data: {
      cluster: {
        id: cluster.id,
        name: cluster.name,
        pillarName: cluster.pillar ?? null,
        primaryKeyword: cluster.primaryKeyword ?? null,
        generationStatus: cluster.generationStatus,
        triggerBriefId: cluster.triggerBriefId,
        proposedHub: cluster.proposedHub,
        proposedSpokes: cluster.proposedSpokes,
        pendingSpokeBriefIds: cluster.pendingSpokeBriefIds ?? [],
      },
      hubArticle,
      spokeArticles,
      pipelineRuns: pipelineRunsForCluster.map((r) => ({
        id: r.id,
        pipelineName: r.pipelineName,
        status: r.status,
        articleId: (r.input as Record<string, unknown>)?.articleId ?? null,
        createdAt: r.createdAt,
      })),
      cost: {
        spentEur: totalCostEur,
        estimatedEur: 4.2,
      },
      progress: {
        completed: completedCount,
        expected: expectedCount,
        percent: progressPercent,
      },
    },
  });
});

// ─── GET /:slug/clusters ──────────────────────────────────────────────────────

const VALID_GENERATION_STATUSES = [
  "proposed", "plan_proposed", "running", "completed", "partial", "failed", "manual",
] as const;

const clustersListQuerySchema = paginationQuerySchema.extend({
  pillarId: z.string().uuid().optional(),
  generationStatus: z.enum(VALID_GENERATION_STATUSES).optional(),
  search: z.string().min(2).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // 56.2: cursor-based pagination for Load More UX
  cursor: z.string().datetime().optional(),
});

clusterCreatorRoutes.get(
  "/:slug/clusters",
  zValidator("query", clustersListQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const conditions = [eq(clusters.projectId, project.id)];
    if (q.pillarId) conditions.push(eq(clusters.pillarId, q.pillarId));
    if (q.generationStatus) conditions.push(eq(clusters.generationStatus, q.generationStatus as ClusterGenerationStatus));
    if (q.search) {
      const pattern = `%${q.search}%`;
      conditions.push(ilike(clusters.name, pattern));
    }
    if (q.cursor) {
      conditions.push(lt(clusters.createdAt, new Date(q.cursor)));
    }
    const whereClause = and(...conditions);

    const limit = q.limit;
    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: clusters.id,
          name: clusters.name,
          pillarId: clusters.pillarId,
          pillarName: contentPillars.name,
          primaryKeyword: clusters.primaryKeyword,
          cornerstoneKeywords: clusters.cornerstoneKeywords,
          pillarArticleId: clusters.pillarArticleId,
          generationStatus: clusters.generationStatus,
          position: clusters.position,
          createdAt: clusters.createdAt,
          articleCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id})::int, 0)`,
          cornerstoneCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id} and ${articles.cornerstoneSpecId} is not null)::int, 0)`,
        })
        .from(clusters)
        .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
        .where(whereClause)
        .orderBy(asc(clusters.position), asc(clusters.createdAt))
        .limit(limit + (q.cursor ? 1 : 0))
        .offset(q.cursor ? 0 : q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(clusters)
        .where(whereClause),
    ]);

    const pillarArticleIds = rows
      .map((r) => r.pillarArticleId)
      .filter((id): id is string => id !== null);

    const titleMap = new Map<string, string | null>();
    if (pillarArticleIds.length > 0) {
      const titles = await db
        .select({
          id: articles.id,
          title: articles.title,
          cornerstoneKeyword: articles.cornerstoneKeyword,
        })
        .from(articles)
        .where(inArray(articles.id, pillarArticleIds));
      for (const t of titles) {
        titleMap.set(t.id, t.title ?? t.cornerstoneKeyword ?? null);
      }
    }

    if (q.cursor) {
      // Cursor mode: hasMore determined by the extra row fetched
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      const pillarArticleIds = pageRows
        .map((r) => r.pillarArticleId)
        .filter((id): id is string => id !== null);
      const titleMap = new Map<string, string | null>();
      if (pillarArticleIds.length > 0) {
        const titles = await db
          .select({ id: articles.id, title: articles.title, cornerstoneKeyword: articles.cornerstoneKeyword })
          .from(articles)
          .where(inArray(articles.id, pillarArticleIds));
        for (const t of titles) titleMap.set(t.id, t.title ?? t.cornerstoneKeyword ?? null);
      }

      const items = pageRows.map((r) => ({
        ...r,
        pillarArticleTitle: r.pillarArticleId ? (titleMap.get(r.pillarArticleId) ?? null) : null,
      }));
      const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null; // safe: items is non-empty when hasMore=true (fetched limit+1)

      return c.json({ ok: true, data: { items, nextCursor, hasMore, limit } });
    }

    // Offset mode (legacy): enrich and paginate
    const offsetPillarArticleIds = rows
      .map((r) => r.pillarArticleId)
      .filter((id): id is string => id !== null);

    const offsetTitleMap = new Map<string, string | null>();
    if (offsetPillarArticleIds.length > 0) {
      const titles = await db
        .select({
          id: articles.id,
          title: articles.title,
          cornerstoneKeyword: articles.cornerstoneKeyword,
        })
        .from(articles)
        .where(inArray(articles.id, offsetPillarArticleIds));
      for (const t of titles) {
        offsetTitleMap.set(t.id, t.title ?? t.cornerstoneKeyword ?? null);
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      pillarArticleTitle: r.pillarArticleId ? (offsetTitleMap.get(r.pillarArticleId) ?? null) : null,
    }));

    return c.json({ ok: true, data: paginated(enriched, countRows, q) });
  },
);
