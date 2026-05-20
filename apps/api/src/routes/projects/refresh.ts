import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  asc,
  cronState,
  desc,
  db,
  eq,
  isNull,
  lt,
  projects,
  refreshDismissed,
  refreshSuggestions,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { COST_OPS, estimateCostEur, assertCostBudget } from "@marketing-auto/core";
import { effectiveFreshnessSql } from "@marketing-auto/cost-tracker";
import { enqueueRefreshPipeline } from "@marketing-auto/pipelines";
import { markArticleRefreshed } from "@marketing-auto/db";
import {
  enqueueArticleQualityAnalysis,
} from "@marketing-auto/pipelines/article-quality-analysis-queue";
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
    ).toISOString();

    // Canonical effective-freshness expression (frontmatterUpdatedAt → lastRefreshedAt →
    // publishedAt → updatedAt). Must stay in sync with `detectStaleArticles` (worker)
    // + `/discovery-counts` or the views diverge.
    const conditions = [
      eq(articles.projectId, project.id),
      eq(articles.status, "published"),
      sql`${effectiveFreshnessSql} < ${cutoff}`,
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
        daysSinceLastUpdate: sql<number>`EXTRACT(DAY FROM NOW() - ${effectiveFreshnessSql})::int`,
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

// ─── GET /:slug/refresh-detection/status ──────────────────────────────────────
//
// Returns the freshest "last detection" timestamp from two independent sources:
//   - cron_state.last_run_at — only updated when the orchestrator fires a scheduled cron run
//   - refresh_suggestions.generated_at — set whenever the worker persists a candidate (manual OR cron)
// The UI label takes the newer of the two so manual runs surface immediately.

projectRefreshRoutes.get("/:slug/refresh-detection/status", async (c) => {
  const { slug } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [cron] = await db
    .select({ isActive: cronState.isActive, lastRunAt: cronState.lastRunAt })
    .from(cronState)
    .where(and(eq(cronState.projectId, project.id), eq(cronState.jobType, "refresh_detector")))
    .limit(1);

  const [latestSuggestion] = await db
    .select({ generatedAt: sql<string | null>`max(${refreshSuggestions.generatedAt})` })
    .from(refreshSuggestions)
    .where(eq(refreshSuggestions.projectId, project.id));

  const cronLastRunAt = cron?.lastRunAt?.toISOString() ?? null;
  const manualLastDetectedAt = latestSuggestion?.generatedAt ?? null;

  // lastRunAt = the freshest of the two — drives the simple "last detection" label
  const lastRunAt = !cronLastRunAt
    ? manualLastDetectedAt
    : !manualLastDetectedAt
      ? cronLastRunAt
      : new Date(cronLastRunAt) >= new Date(manualLastDetectedAt)
        ? cronLastRunAt
        : manualLastDetectedAt;

  return c.json({
    ok: true,
    data: {
      active: cron?.isActive ?? false,
      lastRunAt,
      cronLastRunAt,
      manualLastDetectedAt,
    },
  });
});

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

// ─── POST /:slug/articles/quality-analysis ────────────────────────────────────
// Enqueue quality analysis jobs for all published articles (or a subset via body.articleIds).

const qualityAnalysisBodySchema = z.object({
  articleIds: z.array(z.string().uuid()).optional(),
});

projectRefreshRoutes.post(
  "/:slug/articles/quality-analysis",
  async (c) => {
    const { slug } = c.req.param();
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const rawBody = await c.req.json().catch(() => ({}));
    const { articleIds } = qualityAnalysisBodySchema.safeParse(rawBody).data ?? {};

    let targetIds: string[];
    if (articleIds && articleIds.length > 0) {
      targetIds = articleIds;
    } else {
      const all = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(
          eq(articles.projectId, project.id),
          eq(articles.status, "published"),
        ));
      targetIds = all.map((a) => a.id);
    }

    const perArticleCost = estimateCostEur("anthropic", COST_OPS.ARTICLE_QUALITY_ANALYSIS);
    const batchCostEur = Math.round(targetIds.length * perArticleCost * 100) / 100;

    // Pre-flight budget check before enqueuing any jobs
    try {
      await assertCostBudget(project.id, "anthropic", batchCostEur);
    } catch {
      return c.json({ ok: false, error: "cost_limit_exceeded", estimatedCostEur: batchCostEur }, 402);
    }

    const jobIds: string[] = [];
    for (const articleId of targetIds) {
      const jobId = await enqueueArticleQualityAnalysis({
        articleId,
        projectId: project.id,
        projectSlug: slug,
      });
      jobIds.push(jobId);
    }

    log.info({ slug, count: targetIds.length, estimatedCostEur: batchCostEur }, "Quality analysis batch enqueued");

    return c.json({ ok: true, data: { enqueued: targetIds.length, estimatedCostEur: batchCostEur, jobIds } });
  }
);

// ─── GET /:slug/refresh-suggestions ──────────────────────────────────────────
// Priority-ordered: quality refresh-now → quality refresh-soon → time-based

projectRefreshRoutes.get("/:slug/refresh-suggestions", async (c) => {
  const { slug } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .select({
      id: refreshSuggestions.id,
      source: refreshSuggestions.source,
      reasoning: refreshSuggestions.reasoning,
      stalenessDays: refreshSuggestions.stalenessDays,
      qualityFindings: refreshSuggestions.qualityFindings,
      generatedAt: refreshSuggestions.generatedAt,
      articleId: articles.id,
      articleTitle: articles.title,
      articleSlug: articles.slug,
      articleLocale: articles.locale,
      articleLastRefreshedAt: articles.lastRefreshedAt,
    })
    .from(refreshSuggestions)
    .innerJoin(articles, eq(refreshSuggestions.articleId, articles.id))
    .where(and(
      eq(articles.projectId, project.id),
      isNull(refreshSuggestions.dismissedAt),
      isNull(refreshSuggestions.approvedAt),
    ))
    .orderBy(
      sql`CASE
        WHEN ${refreshSuggestions.source} = 'quality' AND ${refreshSuggestions.qualityFindings}->>'overallRecommendation' = 'refresh-now' THEN 1
        WHEN ${refreshSuggestions.source} = 'quality' AND ${refreshSuggestions.qualityFindings}->>'overallRecommendation' = 'refresh-soon' THEN 2
        WHEN ${refreshSuggestions.source} = 'time' THEN 3
        ELSE 4
      END`,
      desc(refreshSuggestions.generatedAt)
    );

  return c.json({ ok: true, data: { suggestions: rows } });
});

// ─── POST /:slug/articles/:articleId/mark-refreshed ──────────────────────────
// Sets lastRefreshedAt + closes all active suggestions for the article.

projectRefreshRoutes.post("/:slug/articles/:articleId/mark-refreshed", async (c) => {
  const { slug, articleId } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.projectId, project.id)))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "article_not_found" }, 404);

  await markArticleRefreshed(articleId);

  // Close all active suggestions (both time + quality) for this article
  await db
    .update(refreshSuggestions)
    .set({ approvedAt: new Date() })
    .where(and(
      eq(refreshSuggestions.articleId, articleId),
      isNull(refreshSuggestions.dismissedAt),
      isNull(refreshSuggestions.approvedAt),
    ));

  log.info({ slug, articleId }, "Article marked as refreshed; suggestions closed");
  return c.json({ ok: true, data: { articleId } });
});

// ─── DELETE /:slug/refresh-suggestions/:id ────────────────────────────────────
// Dismiss a specific refresh suggestion.

projectRefreshRoutes.delete("/:slug/refresh-suggestions/:id", async (c) => {
  const { slug, id } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .update(refreshSuggestions)
    .set({ dismissedAt: new Date() })
    .where(and(
      eq(refreshSuggestions.id, id),
      eq(refreshSuggestions.projectId, project.id),
    ))
    .returning({ id: refreshSuggestions.id });

  if (rows.length === 0) return c.json({ ok: false, error: "suggestion_not_found" }, 404);

  log.info({ slug, id }, "Refresh suggestion dismissed");
  return c.json({ ok: true, data: { id } });
});
