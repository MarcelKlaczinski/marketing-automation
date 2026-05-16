import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  clusters,
  contentPillars,
  db,
  desc,
  eq,
  inArray,
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
  lane: z.enum(VALID_ARTICLE_STATUSES).optional(),
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
  if (q.lane) conditions.push(eq(articles.status, q.lane));
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
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
