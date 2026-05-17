import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  clusters,
  contentPillars,
  db,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  projects,
  sql,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../../lib/pagination.ts";
import { requireAuth } from "../../middleware/auth.ts";

export const scopedArticleRoutes = new Hono();
scopedArticleRoutes.use(requireAuth);

const VALID_ARTICLE_STATUSES = [
  "proposed", "approved", "generating", "outline_review", "drafting",
  "final_review", "schema_extending", "ready_to_publish", "validating",
  "published", "blocked_by_pagespeed", "failed", "rejected",
] as const;

// ─── GET /api/projects/:slug/articles ─────────────────────────────────────────

const articlesListQuerySchema = paginationQuerySchema.extend({
  // Legacy: lane filter used by dashboard lanes
  lane: z.enum(VALID_ARTICLE_STATUSES).optional(),
  // 56.2: extended filters for articles view
  status: z.enum(VALID_ARTICLE_STATUSES).optional(),
  collection: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
  search: z.string().min(2).optional(),
  // 56.2: cursor-based pagination (preferred over offset for Load More UX)
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

scopedArticleRoutes.get("/:slug/articles", zValidator("query", articlesListQuerySchema), async (c) => {
  const { slug } = c.req.param();
  const q = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const conditions = [eq(articles.projectId, project.id)];
  // status or lane (lane kept for dashboard backward compat)
  const statusFilter = q.status ?? q.lane;
  if (statusFilter) conditions.push(eq(articles.status, statusFilter));
  if (q.collection) conditions.push(eq(articles.collection, q.collection));
  if (q.locale) conditions.push(eq(articles.locale, q.locale));
  if (q.search) {
    const pattern = `%${q.search}%`;
    conditions.push(
      or(
        ilike(articles.title, pattern),
        ilike(articles.slug, pattern),
        ilike(articles.cornerstoneKeyword, pattern),
      )!,
    );
  }
  if (q.cursor) {
    conditions.push(lt(articles.updatedAt, new Date(q.cursor)));
  }

  const whereClause = and(...conditions);

  if (q.cursor) {
    // Cursor mode: fetch limit+1 to determine hasMore; no count query needed
    const limit = q.limit;
    const rows = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        collection: articles.collection,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        status: articles.status,
        cornerstoneSpecId: articles.cornerstoneSpecId,
        clusterId: articles.clusterId,
        clusterName: clusters.name,
        pillarId: clusters.pillarId,
        pillarName: contentPillars.name,
        pillarPosition: contentPillars.position,
        wordCount: articles.wordCount,
        publishedAt: articles.publishedAt,
        astroSyncedAt: articles.astroSyncedAt,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
        locale: articles.locale,
        source: articles.source,
        translationKey: articles.translationKey,
        heroImagePublicUrl: articles.heroImagePublicUrl,
      })
      .from(articles)
      .leftJoin(clusters, eq(articles.clusterId, clusters.id))
      .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.updatedAt.toISOString() : null; // safe: items is non-empty when hasMore=true (fetched limit+1)

    return c.json({ ok: true, data: { items, nextCursor, hasMore, limit } });
  }

  // Offset mode (legacy dashboard): return paginated envelope with total count
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        collection: articles.collection,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        status: articles.status,
        cornerstoneSpecId: articles.cornerstoneSpecId,
        clusterId: articles.clusterId,
        clusterName: clusters.name,
        pillarId: clusters.pillarId,
        pillarName: contentPillars.name,
        pillarPosition: contentPillars.position,
        wordCount: articles.wordCount,
        publishedAt: articles.publishedAt,
        astroSyncedAt: articles.astroSyncedAt,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
        locale: articles.locale,
        source: articles.source,
        translationKey: articles.translationKey,
        heroImagePublicUrl: articles.heroImagePublicUrl,
      })
      .from(articles)
      .leftJoin(clusters, eq(articles.clusterId, clusters.id))
      .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(articles).where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── GET /api/projects/:slug/articles/count ───────────────────────────────────

const articlesCountQuerySchema = z.object({
  window: z.enum(["day", "week", "month"]).default("week"),
});

scopedArticleRoutes.get("/:slug/articles/count", zValidator("query", articlesCountQuerySchema), async (c) => {
  const { slug } = c.req.param();
  const q = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const windowMs = q.window === "day" ? 86_400_000 : q.window === "week" ? 7 * 86_400_000 : 30 * 86_400_000;
  const since = new Date(Date.now() - windowMs);

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .where(and(eq(articles.projectId, project.id), gte(articles.createdAt, since)));

  return c.json({ ok: true, data: { count: result[0]?.count ?? 0, window: q.window } });
});

// ─── GET /api/projects/:slug/articles/imported/collections ────────────────────

scopedArticleRoutes.get("/:slug/articles/imported/collections", async (c) => {
  const { slug } = c.req.param();

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .select({
      collection: articles.collection,
      locale: articles.locale,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(and(eq(articles.projectId, project.id), eq(articles.source, "imported")))
    .groupBy(articles.collection, articles.locale);

  const summary: Record<string, { de: number; en: number; total: number }> = {};
  for (const row of rows) {
    const coll = row.collection ?? "unknown";
    summary[coll] = summary[coll] ?? { de: 0, en: 0, total: 0 };
    if (row.locale === "de") summary[coll]!.de = row.count;
    else if (row.locale === "en") summary[coll]!.en = row.count;
    summary[coll]!.total += row.count;
  }

  return c.json({ ok: true, data: summary });
});

// ─── GET /api/projects/:slug/articles/imported ────────────────────────────────

const importedQuerySchema = paginationQuerySchema.extend({
  collection: z.string().optional(),
});

scopedArticleRoutes.get("/:slug/articles/imported", zValidator("query", importedQuerySchema), async (c) => {
  const { slug } = c.req.param();
  const q = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const conditions = [eq(articles.projectId, project.id), eq(articles.source, "imported")];
  if (q.collection) conditions.push(eq(articles.collection, q.collection));
  const whereClause = and(...conditions);

  const [keyRows, countRows] = await Promise.all([
    db
      .select({ translationKey: articles.translationKey })
      .from(articles)
      .where(whereClause)
      .groupBy(articles.translationKey)
      .orderBy(desc(sql`MAX(${articles.frontmatterUpdatedAt})`))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(DISTINCT ${articles.translationKey})::int` })
      .from(articles)
      .where(whereClause),
  ]);

  const keys = keyRows.map((r) => r.translationKey).filter((k): k is string => !!k);

  const articleRows = keys.length > 0
    ? await db
        .select({
          id: articles.id,
          collection: articles.collection,
          locale: articles.locale,
          slug: articles.slug,
          title: articles.title,
          metaDescription: articles.metaDescription,
          translationKey: articles.translationKey,
          author: articles.author,
          category: articles.category,
          subcategory: articles.subcategory,
          tags: articles.tags,
          publishedAt: articles.publishedAt,
          frontmatterUpdatedAt: articles.frontmatterUpdatedAt,
          filePath: articles.filePath,
          frontmatterExtras: articles.frontmatterExtras,
          importMetadata: articles.importMetadata,
          lastImportedAt: articles.lastImportedAt,
          clusterKey: articles.clusterKey,
          clusterRole: articles.clusterRole,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, project.id),
            eq(articles.source, "imported"),
            inArray(articles.translationKey, keys)
          )
        )
    : [];

  type ArticleRow = (typeof articleRows)[number];
  const pairs = keys.map((key) => {
    const members = articleRows.filter((a) => a.translationKey === key);
    return {
      translationKey: key,
      de: members.find((m) => m.locale === "de") ?? null,
      en: members.find((m) => m.locale === "en") ?? null,
    };
  }) satisfies Array<{ translationKey: string; de: ArticleRow | null; en: ArticleRow | null }>;

  return c.json({ ok: true, data: paginated(pairs, countRows, q) });
});
