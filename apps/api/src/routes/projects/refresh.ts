import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  asc,
  db,
  eq,
  isNull,
  lt,
  projects,
  refreshDismissed,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { COST_OPS, estimateCostEur } from "@marketing-auto/core";
import { enqueueRefreshPipeline } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { detectStaleArticles } from "../../workers/refresh-detector.ts";
import { triggerWithPreRunId, triggerResultToResponse } from "../_lib/trigger-helpers.ts";

const log = createLogger("api:refresh-routes");

export const projectRefreshRoutes = new Hono();
projectRefreshRoutes.use(requireAuth);

// ─── Helper: resolve project ──────────────────────────────────────────────────

async function resolveProject(slug: string) {
  const [project] = await db
    .select({
      id: projects.id,
      refreshStalenessThresholdDays: projects.refreshStalenessThresholdDays,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return project ?? null;
}

// ─── GET /:slug/refresh-candidates ────────────────────────────────────────────

const refreshCandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime().optional(),
});

projectRefreshRoutes.get(
  "/:slug/refresh-candidates",
  zValidator("query", refreshCandidatesQuerySchema),
  async (c) => {
    const { slug } = c.req.param();
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const q = c.req.valid("query");
    const cutoff = new Date(
      Date.now() - project.refreshStalenessThresholdDays * 24 * 60 * 60 * 1000
    );

    const conditions = [
      eq(articles.projectId, project.id),
      eq(articles.status, "published"),
      lt(
        sql`COALESCE(${articles.publishedAt}, ${articles.updatedAt})`,
        cutoff.toISOString()
      ),
      isNull(refreshDismissed.id),
    ];

    if (q.cursor) {
      conditions.push(lt(articles.updatedAt, new Date(q.cursor)));
    }

    const limit = q.limit;
    const rows = await db
      .select({
        id: articles.id,
        title: articles.title,
        slug: articles.slug,
        collection: articles.collection,
        locale: articles.locale,
        clusterId: articles.clusterId,
        publishedAt: articles.publishedAt,
        updatedAt: articles.updatedAt,
        daysSinceLastUpdate: sql<number>`
          EXTRACT(DAY FROM NOW() - COALESCE(${articles.publishedAt}, ${articles.updatedAt}))::int
        `,
      })
      .from(articles)
      .leftJoin(
        refreshDismissed,
        and(
          eq(refreshDismissed.projectId, project.id),
          eq(refreshDismissed.articleId, articles.id)
        )
      )
      .where(and(...conditions))
      .orderBy(asc(articles.updatedAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.updatedAt.toISOString() : null;

    return c.json({
      ok: true,
      data: { candidates: items, hasMore, nextCursor, limit },
    });
  }
);

// ─── POST /:slug/refresh-detection/run ────────────────────────────────────────

projectRefreshRoutes.post("/:slug/refresh-detection/run", async (c) => {
  const { slug } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  log.info({ slug }, "Manual refresh detection triggered");
  const result = await detectStaleArticles(project.id);

  return c.json({
    ok: true,
    data: {
      candidateCount: result.candidateCount,
      candidates: result.candidates,
    },
  });
});

// ─── POST /:slug/refresh-candidates/:articleId/dismiss ────────────────────────

projectRefreshRoutes.post("/:slug/refresh-candidates/:articleId/dismiss", async (c) => {
  const { slug, articleId } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.projectId, project.id)))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "article_not_found" }, 404);

  await db
    .insert(refreshDismissed)
    .values({
      projectId: project.id,
      articleId,
      dismissedBy: c.var.user?.email ?? "user",
    })
    .onConflictDoNothing();

  log.info({ slug, articleId }, "Article dismissed from refresh queue");
  return c.json({ ok: true, data: { articleId } });
});

// ─── POST /:slug/refresh-candidates/:articleId/trigger ────────────────────────

projectRefreshRoutes.post("/:slug/refresh-candidates/:articleId/trigger", async (c) => {
  const { slug, articleId } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [article] = await db
    .select({
      id: articles.id,
      projectId: articles.projectId,
      title: articles.title,
      slug: articles.slug,
      cornerstoneKeyword: articles.cornerstoneKeyword,
      locale: articles.locale,
      intentType: articles.intentType,
      clusterId: articles.clusterId,
      metaDescription: articles.metaDescription,
      updatedAt: articles.updatedAt,
      source: articles.source,
    })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.projectId, project.id)))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "article_not_found" }, 404);
  if (article.source !== "generated") {
    return c.json({ ok: false, error: "only_generated_articles_can_be_refreshed" }, 422);
  }

  const staleDays = Math.floor(
    (Date.now() - new Date(article.updatedAt).getTime()) / 86_400_000
  );

  const [brief] = await db
    .insert(topicBriefs)
    .values({
      projectId: project.id,
      source: "refresh_detection",
      topicTitle: article.title ?? "",
      primaryKeyword: article.cornerstoneKeyword ?? "",
      locale: article.locale,
      intentType: article.intentType ?? null,
      clusterId: article.clusterId,
      clusterAction: "refresh",
      suggestedTitle: article.title,
      suggestedSlug: article.slug,
      suggestedMeta: article.metaDescription,
      approvalStatus: "approved",
      approvedBy: c.var.user?.email ?? "user",
      refreshMetadata: {
        targetArticleId: article.id,
        reason: "manual-trigger",
        staleness: {
          daysSinceLastUpdate: staleDays,
          rankingChange: null,
          competitorRefreshed: false,
        },
      },
    })
    .returning();

  if (!brief) return c.json({ ok: false, error: "failed_to_create_brief" }, 500);

  const refreshCostEur =
    estimateCostEur("anthropic", COST_OPS.REFRESH_OUTLINE) +
    estimateCostEur("anthropic", COST_OPS.REFRESH_DRAFT) +
    estimateCostEur("anthropic", COST_OPS.ARTICLE_SELF_REVIEW);

  const result = await triggerWithPreRunId({
    pipelineName: "article:refresh",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", estimatedCostEur: refreshCostEur },
    extraInput: { articleId: article.id, briefId: brief.id },
    enqueue: enqueueRefreshPipeline,
  });

  log.info({ slug, articleId, briefId: brief.id }, "Refresh pipeline triggered from queue");
  return triggerResultToResponse(c, result);
});
