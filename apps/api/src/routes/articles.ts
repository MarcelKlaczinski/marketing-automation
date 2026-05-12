import { zValidator } from "@hono/zod-validator";
import { COST_OPS, estimateCostEur } from "@marketing-auto/core";
import {
  type FrontmatterFieldDescriptor,
  articleVersions,
  articles,
  astroSyncRuns,
  clusters,
  contentPillars,
  db,
  pagespeedRuns,
  pipelineRuns,
  projects,
  schemaExtensionRuns,
} from "@marketing-auto/db";
import { suggestFrontmatterFields } from "../lib/frontmatter-service.ts";
import {
  continueArticleGeneration,
  enqueueArticleDraftPipeline,
  enqueueArticleGenerationLegacy as enqueueArticleGeneration,
  enqueueArticleOutlinePipeline,
  enqueueArticleSyncPipeline,
  enqueuePagespeedApiValidationPipeline,
  enqueuePagespeedValidationPipeline,
  enqueueSchemaExtensionPipeline,
  enqueueHeroImageGenerationPipeline,
  enqueueLocalizeArticlePipeline,
  slugify,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";

// ─── simple YAML serializer (no external dep needed for basic scalar/array types) ─
function toYaml(obj: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else if (typeof v === "string") {
      // Use block scalar for multiline, quoted scalar for single-line
      if (v.includes("\n")) {
        lines.push(`${k}: |`);
        for (const line of v.split("\n")) lines.push(`  ${line}`);
      } else {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      }
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${JSON.stringify(item)}`);
      }
    } else if (typeof v === "object") {
      // Serialize objects as JSON scalar (covers schemaJsonLd)
      lines.push(`${k}: ${JSON.stringify(JSON.stringify(v))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// ─── shared frontmatter builder ────────────────────────────────────────────────

/**
 * Spec 50: Builds a frontmatter object that satisfies the Astro blog collection schema.
 *
 * Field priority (highest → lowest):
 * 1. article.frontmatterExtras — LLM-generated or user-edited values (category, intentType, faq, tags…)
 * 2. Schema-derived defaults — required fields get sensible defaults if not in extras
 * 3. Static article columns — title, slug, heroImage, wordCount, clusterRole, clusterKey, etc.
 *
 * When `schema` is provided the function uses it to know which fields are required
 * and which have enum constraints. Without a schema it falls back to a minimal
 * hardcoded set for the blog collection.
 */
function buildFrontmatter(
  article: {
    title: string | null;
    metaDescription: string | null;
    slug: string;
    locale: string | null;
    heroImageAltText: string | null;
    cornerstoneKeyword: string | null;
    wordCount: number | null;
    heroImagePublicUrl: string | null;
    schemaJsonLd: unknown;
    frontmatterExtras: unknown;
    clusterRole: string | null;
    clusterKey: string | null;
  },
  cluster: { name: string; pillar: string | null } | null,
  schema?: FrontmatterFieldDescriptor[]
): Record<string, unknown> {
  const today = new Date().toISOString().split("T")[0]!;
  const locale = (article.locale as string | null) ?? "de";

  // Merge LLM/user-edited extras (may contain category, intentType, tags, faq…)
  const extras = (article.frontmatterExtras ?? {}) as Record<string, unknown>;

  // Build the base frontmatter from static article columns
  const fm: Record<string, unknown> = {
    title: article.title ?? "",
    slug: article.slug,
    locale,
    pubDate: today,
    heroImageAlt: article.heroImageAltText ?? "",
    cluster: cluster?.name ?? "",
    pillar: cluster?.pillar ?? "",
    cornerstoneKeyword: article.cornerstoneKeyword ?? "",
    wordCount: article.wordCount ?? 0,
    draft: false,
    featured: false,
    ads: false,
    // Cluster role + key from article columns (set by SyncClustersFromFrontmatterStep)
    ...(article.clusterRole ? { clusterRole: article.clusterRole } : {}),
    ...(article.clusterKey ? { clusterKey: article.clusterKey } : {}),
  };

  // Apply schema-required fields with defaults if not already in extras
  if (schema?.length) {
    for (const field of schema.filter((f) => f.required)) {
      if (!(field.name in extras) && !(field.name in fm)) {
        if (field.name === "date" || field.name === "pubDate") {
          fm[field.name] = today;
        } else if (field.name === "excerpt" || field.name === "description") {
          fm[field.name] = article.metaDescription ?? "";
        } else if (field.enumValues?.length) {
          fm[field.name] = field.enumValues[0]; // first enum value as default
        } else if (field.type === "string_array") {
          fm[field.name] = [];
        } else if (field.type === "boolean") {
          fm[field.name] = field.hasDefault ? undefined : false; // let Astro default handle it
        }
      }
    }
  } else {
    // Fallback hardcoded required fields for blog collection
    fm.date = today;
    fm.category = extras.category ?? "Guides & Tutorials";
    fm.excerpt = article.metaDescription ?? "";
  }

  // Overlay extras on top (LLM / user values win over defaults)
  Object.assign(fm, extras);

  // Static columns that always come from DB (not overrideable via extras)
  if (article.heroImagePublicUrl) fm.heroImage = article.heroImagePublicUrl;
  if (article.schemaJsonLd) fm.schemaJsonLd = article.schemaJsonLd;

  return fm;
}
import { requireAuth } from "../middleware/auth.ts";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { triggerResultToResponse, triggerWithPreRunId } from "./_lib/trigger-helpers.ts";
import { recalcPillarArticleId } from "./clusters.ts";

const log = createLogger("routes:articles");

export const articleRoutes = new Hono();

articleRoutes.use(requireAuth);

// ─── shared types ─────────────────────────────────────────────────────────────

const VALID_ARTICLE_STATUSES = [
  "proposed", "approved", "generating", "outline_review", "drafting",
  "final_review", "schema_extending", "ready_to_publish", "validating",
  "published", "blocked_by_pagespeed", "failed", "rejected",
] as const;
type ArticleStatus = typeof VALID_ARTICLE_STATUSES[number];

// ─── list ─────────────────────────────────────────────────────────────────────

const articlesListQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  lane: z.enum(VALID_ARTICLE_STATUSES).optional(),
});

articleRoutes.get("/", zValidator("query", articlesListQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, q.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── across-projects ──────────────────────────────────────────────────────────

const acrossProjectsQuerySchema = paginationQuerySchema.extend({
  statuses: z.string(),
});

articleRoutes.get("/across-projects", zValidator("query", acrossProjectsQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const requested = q.statuses.split(",").map((s) => s.trim());
  const statuses = requested.filter((s): s is ArticleStatus =>
    (VALID_ARTICLE_STATUSES as readonly string[]).includes(s)
  );
  if (statuses.length === 0) {
    return c.json({ ok: false, error: "no valid statuses" }, 400);
  }

  const whereClause = inArray(articles.status, statuses);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        status: articles.status,
        cornerstoneSpecId: articles.cornerstoneSpecId,
        projectId: articles.projectId,
        projectName: projects.name,
        projectSlug: projects.slug,
        clusterId: articles.clusterId,
        clusterName: clusters.name,
        pillarName: contentPillars.name,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .leftJoin(projects, eq(articles.projectId, projects.id))
      .leftJoin(clusters, eq(articles.clusterId, clusters.id))
      .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── imported articles (Spec 44) — must be before /:id wildcard ──────────────

// GET /articles/imported/collections?projectSlug=... — counts per collection
articleRoutes.get("/imported/collections", async (c) => {
  const projectSlug = c.req.query("projectSlug");
  if (!projectSlug) return c.json({ ok: false, error: "projectSlug required" }, 400);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

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

// GET /articles/imported?projectSlug=...&collection=... — translation-pair-grouped rows (paginated by pair)
const importedQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  collection: z.string().optional(),
});

articleRoutes.get("/imported", zValidator("query", importedQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, q.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions = [
    eq(articles.projectId, project.id),
    eq(articles.source, "imported"),
  ];
  if (q.collection) conditions.push(eq(articles.collection, q.collection));
  const whereClause = and(...conditions);

  // Step 1: get paginated distinct translationKeys ordered by most-recent update
  const [keyRows, countRows] = await Promise.all([
    db
      .select({
        translationKey: articles.translationKey,
      })
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

  // Step 2: load all articles for these translationKeys
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

  // Step 3: group into pairs, preserving key order from step 1
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

// GET /articles/imported/:id — detail with translation pendant
articleRoutes.get("/imported/:id", async (c) => {
  const id = c.req.param("id");

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.source, "imported")))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  let pendant = null;
  if (article.translationKey) {
    const [p] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.projectId, article.projectId),
          eq(articles.source, "imported"),
          eq(articles.translationKey, article.translationKey),
          ne(articles.id, id)
        )
      )
      .limit(1);
    pendant = p ?? null;
  }

  return c.json({ ok: true, data: { article, pendant } });
});

// ─── pipeline-run cleanup ─────────────────────────────────────────────────────

articleRoutes.post("/pipeline-runs/fix-stuck", async (c) => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await db
    .update(pipelineRuns)
    .set({ status: "failed", errorMessage: "Stuck run reset by admin cleanup" })
    .where(and(eq(pipelineRuns.status, "running"), lt(pipelineRuns.startedAt, thirtyMinAgo)))
    .returning({ id: pipelineRuns.id });
  log.info({ fixed: rows.length }, "Stuck pipeline runs reset by admin cleanup");
  return c.json({ ok: true, data: { fixed: rows.length } });
});

// ─── frontmatter preview + extras ─────────────────────────────────────────────

articleRoutes.get("/:id/frontmatter", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [[cluster], [project]] = await Promise.all([
    article.clusterId
      ? db
          .select({ name: clusters.name, pillar: clusters.pillar })
          .from(clusters)
          .where(eq(clusters.id, article.clusterId))
          .limit(1)
      : Promise.resolve([null]),
    db
      .select({ astroCollectionSchemas: projects.astroCollectionSchemas })
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1),
  ]);

  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const collectionSchema = schemas?.["blog"] ?? undefined;

  const fm = buildFrontmatter(article, cluster ?? null, collectionSchema);
  const yaml = toYaml(fm);

  return c.json({
    ok: true,
    data: {
      yaml,
      slug: article.slug,
      extras: (article.frontmatterExtras ?? {}) as Record<string, unknown>,
      schema: collectionSchema ?? null,
    },
  });
});

// PATCH /:id/frontmatter-extras — save user-edited / LLM-suggested extras
articleRoutes.patch(
  "/:id/frontmatter-extras",
  zValidator(
    "json",
    z.object({
      extras: z.record(z.unknown()),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { extras } = c.req.valid("json");

    const [article] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, id)).limit(1);
    if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

    await db
      .update(articles)
      .set({ frontmatterExtras: extras, frontmatterUpdatedAt: new Date() })
      .where(eq(articles.id, id));

    return c.json({ ok: true, data: { saved: true } });
  }
);

// POST /:id/frontmatter-suggest — Haiku-powered field suggestions
articleRoutes.post("/:id/frontmatter-suggest", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [project] = await db
    .select({ astroCollectionSchemas: projects.astroCollectionSchemas })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const schema = schemas?.["blog"] ?? null;

  if (!schema) {
    return c.json(
      { ok: false, error: "No schema stored for this project yet. Run an Astro import first." },
      422
    );
  }

  // Use first ~600 words of body as context
  const bodyExcerpt = article.bodyMd
    ? article.bodyMd.split(/\s+/).slice(0, 600).join(" ")
    : null;

  const suggestions = await suggestFrontmatterFields({
    projectId: article.projectId,
    pipelineRunId: crypto.randomUUID(), // one-off cost-tracking run
    title: article.title,
    metaDescription: article.metaDescription,
    bodyExcerpt,
    schema,
    currentExtras: (article.frontmatterExtras ?? {}) as Record<string, unknown>,
  });

  return c.json({ ok: true, data: suggestions });
});

// ─── local Astro dev preview ──────────────────────────────────────────────────

articleRoutes.post("/:id/local-preview", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  // Read localPath + collection schemas from project
  const [project] = await db
    .select({ astroRepo: projects.astroRepo, astroCollectionSchemas: projects.astroCollectionSchemas })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const astroRepo = project?.astroRepo as {
    localPath?: string;
    previewPath?: string;
  } | null;
  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const collectionSchema = schemas?.["blog"] ?? undefined;
  const repoPath = astroRepo?.localPath ?? null;
  if (!repoPath) {
    return c.json(
      {
        ok: false,
        error:
          "No local Astro path configured. Set astroRepo.localPath on the project (e.g. via Drizzle Studio).",
      },
      422
    );
  }

  const [cluster] = article.clusterId
    ? await db
        .select({ name: clusters.name, pillar: clusters.pillar })
        .from(clusters)
        .where(eq(clusters.id, article.clusterId))
        .limit(1)
    : [null];

  const locale = (article.locale as string | null) ?? "de";

  const fm = buildFrontmatter(article, cluster ?? null, collectionSchema);
  const yamlStr = toYaml(fm);

  const mdxContent = [
    yamlStr,
    "",
    "<!-- AUTO-GENERATED preview — do not commit -->",
    "",
    article.bodyMd ?? "",
  ].join("\n");

  // Write into the locale subdirectory (src/content/blog/de/ or /en/)
  // matching the Astro content collection structure used by toolwiki/ki-wissensraum.
  const blogDir = path.join(repoPath, "src", "content", "blog", locale);
  await mkdir(blogDir, { recursive: true });
  const mdxPath = path.join(blogDir, `${article.slug}.mdx`);
  await Bun.write(mdxPath, mdxContent);

  // Copy local hero image if it's a local URL
  if (article.heroImagePublicUrl) {
    const url = article.heroImagePublicUrl;
    if (url.startsWith("/uploads/") || url.includes("localhost")) {
      const basename = path.basename(url);
      const key = url.replace(/^\/uploads\//, "");
      const srcFile = path.join(".", "uploads", key);
      const destDir = path.join(repoPath, "src", "assets", "hero");
      await mkdir(destDir, { recursive: true });
      const destFile = path.join(destDir, basename);
      try {
        const srcBuf = await Bun.file(srcFile).arrayBuffer();
        await Bun.write(destFile, srcBuf);
      } catch {
        log.warn({ srcFile, destFile }, "Could not copy hero image for local preview");
      }
    }
  }

  // Build preview URL: use configurable template or fall back to /{locale}/blog/{slug}
  const pathTemplate = astroRepo?.previewPath ?? "/{locale}/blog/{slug}";
  const previewPath = pathTemplate
    .replace("{locale}", locale)
    .replace("{slug}", article.slug);
  const previewUrl = `http://localhost:4321${previewPath}`;

  return c.json({
    ok: true,
    data: { url: previewUrl, slug: article.slug, repoPath },
  });
});

// ─── detail ───────────────────────────────────────────────────────────────────

articleRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [proj] = await db
    .select({ slug: projects.slug, astroRepo: projects.astroRepo })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const [cluster] = article.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1)
    : [null];

  // Look up translation sibling (same translationKey, opposite locale)
  const translationSibling = article.translationKey
    ? await db
        .select({ id: articles.id, locale: articles.locale, status: articles.status })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, article.projectId),
            eq(articles.translationKey, article.translationKey),
            ne(articles.id, article.id)
          )
        )
        .limit(1)
    : [];

  const [pillar] = cluster?.pillarId
    ? await db.select().from(contentPillars).where(eq(contentPillars.id, cluster.pillarId)).limit(1)
    : [null];

  const [recentSync, recentPagespeed, recentSchema] = await Promise.all([
    db
      .select()
      .from(astroSyncRuns)
      .where(eq(astroSyncRuns.articleId, id))
      .orderBy(desc(astroSyncRuns.startedAt))
      .limit(5),
    db
      .select()
      .from(pagespeedRuns)
      .where(eq(pagespeedRuns.articleId, id))
      .orderBy(desc(pagespeedRuns.startedAt))
      .limit(5),
    db
      .select()
      .from(schemaExtensionRuns)
      .where(eq(schemaExtensionRuns.articleId, id))
      .orderBy(desc(schemaExtensionRuns.startedAt))
      .limit(5),
  ]);

  // Fetch outline + draft pipeline runs linked to this article
  const pipelineRunIds = [
    (article as { outlinePipelineRunId?: string | null }).outlinePipelineRunId,
    (article as { draftPipelineRunId?: string | null }).draftPipelineRunId,
  ].filter((runId): runId is string => runId != null);

  const recentPipeline = pipelineRunIds.length > 0
    ? await db
        .select({
          id: pipelineRuns.id,
          pipelineName: pipelineRuns.pipelineName,
          status: pipelineRuns.status,
          stepName: pipelineRuns.stepName,
          startedAt: pipelineRuns.startedAt,
          completedAt: pipelineRuns.completedAt,
          errorMessage: pipelineRuns.errorMessage,
        })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.id, pipelineRunIds))
    : [];

  return c.json({
    ok: true,
    data: {
      article: {
        ...article,
        projectSlug: proj?.slug ?? null,
        projectAstroLocalPath: (proj?.astroRepo as { localPath?: string } | null)?.localPath ?? null,
        translationSibling: translationSibling[0] ?? null, // { id, locale, status } or null
      },
      cluster,
      pillar,
      recentRuns: {
        sync: recentSync,
        pagespeed: recentPagespeed,
        schema: recentSchema,
        pipeline: recentPipeline,
      },
    },
  });
});

// ─── patch metadata ───────────────────────────────────────────────────────────

const ArticleUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  metaDescription: z.string().max(500).optional(),
  cornerstoneKeyword: z.string().min(2).max(200).optional(),
  slug: z
    .string()
    .min(2)
    .max(200)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z
    .enum([
      "proposed",
      "approved",
      "generating",
      "outline_review",
      "drafting",
      "final_review",
      "schema_extending",
      "ready_to_publish",
      "validating",
      "published",
      "blocked_by_pagespeed",
      "failed",
      "rejected",
    ])
    .optional(),
});

articleRoutes.patch("/:id", zValidator("json", ArticleUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [existing] = await db
    .select({ id: articles.id, clusterId: articles.clusterId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!existing) return c.json({ ok: false, error: "Article not found" }, 404);

  // Build update object conditionally — required by exactOptionalPropertyTypes
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
  if (input.cornerstoneKeyword !== undefined) patch.cornerstoneKeyword = input.cornerstoneKeyword;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.status !== undefined) patch.status = input.status;

  await db.update(articles).set(patch).where(eq(articles.id, id));

  // Recalc pillarArticleId when cornerstoneSpecId-related fields change for clustered articles
  if (existing.clusterId && input.cornerstoneKeyword !== undefined) {
    await recalcPillarArticleId(existing.clusterId);
  }

  const [updated] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ─── body update (creates version) ───────────────────────────────────────────

const BodyUpdateSchema = z.object({
  bodyMd: z.string().max(500_000),
  changeReason: z.string().max(500).optional(),
});

articleRoutes.post("/:id/body", zValidator("json", BodyUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(version), 0)::int` })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id));
  const nextVersion = (maxRow?.max ?? 0) + 1;

  const values: typeof articleVersions.$inferInsert = {
    articleId: id,
    version: nextVersion,
    bodyMd: input.bodyMd,
  };
  if (input.changeReason) values.changeReason = input.changeReason;

  await db.insert(articleVersions).values(values);

  await db
    .update(articles)
    .set({
      bodyMd: input.bodyMd,
      wordCount: input.bodyMd.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, id));

  return c.json({ ok: true, data: { version: nextVersion } });
});

// ─── versions list ────────────────────────────────────────────────────────────

articleRoutes.get("/:id/versions", async (c) => {
  const id = c.req.param("id");

  const [exists] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!exists) return c.json({ ok: false, error: "Article not found" }, 404);

  const versions = await db
    .select({
      id: articleVersions.id,
      version: articleVersions.version,
      changeReason: articleVersions.changeReason,
      createdAt: articleVersions.createdAt,
    })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id))
    .orderBy(desc(articleVersions.version));

  return c.json({ ok: true, data: versions });
});

// ─── version body ─────────────────────────────────────────────────────────────

articleRoutes.get("/:id/versions/:version", async (c) => {
  const id = c.req.param("id");
  const version = Number.parseInt(c.req.param("version"), 10);
  if (Number.isNaN(version)) return c.json({ ok: false, error: "Invalid version number" }, 400);

  const [row] = await db
    .select()
    .from(articleVersions)
    .where(and(eq(articleVersions.articleId, id), eq(articleVersions.version, version)))
    .limit(1);
  if (!row) return c.json({ ok: false, error: "Version not found" }, 404);

  return c.json({ ok: true, data: row });
});

// ─── pipeline triggers (preRunId pattern) ─────────────────────────────────────

articleRoutes.post("/:id/generate-outline", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:outline",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleOutlinePipeline,
  });
  log.info({ articleId: id, ...result }, "Outline pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/generate-draft", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:draft",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_DRAFT },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleDraftPipeline,
  });
  log.info({ articleId: id, ...result }, "Draft pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

const generateHeroBodySchema = z.object({
  promptOverride: z.string().min(10).max(1000).optional(),
});

articleRoutes.post("/:id/generate-hero-image", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId, outline: articles.outline })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);
  if (!article.outline) return c.json({ ok: false, error: "Article has no outline yet — generate outline first" }, 422);

  const rawBody = await c.req.json().catch(() => ({}));
  const { promptOverride } = generateHeroBodySchema.safeParse(rawBody).data ?? {};

  const result = await triggerWithPreRunId({
    pipelineName: "article:hero-generation",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "replicate", operation: COST_OPS.HERO_IMAGE },
    extraInput: { articleId: article.id, ...(promptOverride ? { promptOverride } : {}) },
    enqueue: enqueueHeroImageGenerationPipeline,
  });
  log.info({ articleId: id, ...result }, "Hero image pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── localize ─────────────────────────────────────────────────────────────────

const localizeBodySchema = z.object({
  targetLocale: z.enum(["de", "en"]),
  mode: z.enum(["translate", "fresh"]).default("translate"),
});

articleRoutes.post("/:id/localize", async (c) => {
  const id = c.req.param("id");

  const [sourceArticle] = await db
    .select({
      id: articles.id,
      projectId: articles.projectId,
      locale: articles.locale,
      title: articles.title,
      slug: articles.slug,
      metaDescription: articles.metaDescription,
      cornerstoneKeyword: articles.cornerstoneKeyword,
      bodyMd: articles.bodyMd,
      translationKey: articles.translationKey,
      clusterId: articles.clusterId,
      collection: articles.collection,
      cornerstoneSpecId: articles.cornerstoneSpecId,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!sourceArticle) return c.json({ ok: false, error: "Article not found" }, 404);

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = localizeBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { targetLocale, mode } = parsed.data;

  if (sourceArticle.locale === targetLocale) {
    return c.json({ ok: false, error: "Source and target locale are the same" }, 400);
  }

  if (mode === "translate" && !sourceArticle.bodyMd) {
    return c.json({ ok: false, error: "Article has no draft body — run draft pipeline first or use fresh mode" }, 422);
  }

  // Look up project slug for pipeline prompt building
  const [proj] = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, sourceArticle.projectId))
    .limit(1);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  // Ensure translationKey is set on source article (generate from slug if missing)
  let translationKey = sourceArticle.translationKey;
  if (!translationKey) {
    translationKey = slugify(sourceArticle.slug);
    await db
      .update(articles)
      .set({ translationKey, updatedAt: new Date() })
      .where(eq(articles.id, sourceArticle.id));
  }

  // Check if a translation already exists for this locale + translationKey
  const [existing] = await db
    .select({ id: articles.id, status: articles.status })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, sourceArticle.projectId),
        eq(articles.translationKey, translationKey),
        eq(articles.locale, targetLocale)
      )
    )
    .limit(1);

  let targetArticleId: string;

  if (existing) {
    // Re-use existing target article if not currently running
    if (existing.status === "generating" || existing.status === "drafting") {
      return c.json({ ok: false, error: "A localization is already in progress for this article" }, 409);
    }
    targetArticleId = existing.id;
    await db
      .update(articles)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(articles.id, targetArticleId));
  } else {
    // Create the target article stub
    const [created] = await db
      .insert(articles)
      .values({
        projectId: sourceArticle.projectId,
        clusterId: sourceArticle.clusterId,
        locale: targetLocale,
        translationKey,
        title: sourceArticle.title ?? "",
        slug: `${sourceArticle.slug}-${targetLocale}`, // temp — pipeline will overwrite
        metaDescription: sourceArticle.metaDescription,
        cornerstoneKeyword: sourceArticle.cornerstoneKeyword,
        collection: sourceArticle.collection ?? "blog",
        source: "generated",
        status: "generating",
        approvalMode: "manual",
      })
      .returning({ id: articles.id });
    targetArticleId = created!.id;
  }

  const result = await triggerWithPreRunId({
    pipelineName: "article:localize",
    projectId: sourceArticle.projectId,
    uniqueKey: { field: "targetArticleId", value: targetArticleId },
    costEstimate: { service: "anthropic", estimatedCostEur: mode === "translate" ? 1.2 : 0.05 },
    extraInput: {
      sourceArticleId: sourceArticle.id,
      targetArticleId,
      targetLocale,
      mode,
      projectSlug: proj.slug,
    },
    enqueue: enqueueLocalizeArticlePipeline,
  });

  log.info(
    { sourceArticleId: id, targetArticleId, targetLocale, mode, ...result },
    "Localize pipeline triggered via HTTP"
  );
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/sync", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:astro-sync",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleSyncPipeline,
  });
  log.info({ articleId: id, ...result }, "Astro sync triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/validate-pagespeed", async (c) => {
  const id = c.req.param("id");

  // All body fields are optional — parse manually to avoid hard-fail on missing Content-Type
  const rawBody = await c.req.json().catch(() => ({}));
  const bodySchema = z.object({
    mode: z.enum(["local", "api"]).default("local"),
    urlOverride: z.string().url().optional(),
  });
  const body = bodySchema.safeParse(rawBody).data ?? { mode: "local" as const };

  const [article] = await db
    .select({
      id: articles.id,
      projectId: articles.projectId,
      astroCommitSha: articles.astroCommitSha,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  if (body.mode === "api") {
    let resolvedUrl: string;
    if (body.urlOverride) {
      resolvedUrl = body.urlOverride;
    } else {
      const [project] = await db
        .select({ domain: projects.domain })
        .from(projects)
        .where(eq(projects.id, article.projectId))
        .limit(1);

      if (!project?.domain) {
        return c.json(
          {
            ok: false,
            error: "no_domain",
            message:
              "API mode requires either urlOverride or projects.domain to be set. Set the production domain in project settings.",
          },
          400
        );
      }

      const cleanDomain = project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const segments = ["https:/", cleanDomain, article.locale, article.collection, article.slug];
      resolvedUrl = segments.join("/") + "/";
    }

    const result = await triggerWithPreRunId({
      pipelineName: "article:pagespeed-validation-api",
      projectId: article.projectId,
      uniqueKey: { field: "articleId", value: article.id },
      extraInput: { articleId: article.id, url: resolvedUrl },
      enqueue: enqueuePagespeedApiValidationPipeline,
    });
    log.info({ articleId: id, mode: "api", resolvedUrl, ...result }, "PageSpeed API validation triggered");
    return triggerResultToResponse(c, result);
  }

  // local mode: existing cooldown guard + local pipeline
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recentRun] = await db
    .select({ startedAt: pagespeedRuns.startedAt, astroCommitSha: pagespeedRuns.astroCommitSha })
    .from(pagespeedRuns)
    .where(and(eq(pagespeedRuns.articleId, id), gte(pagespeedRuns.startedAt, fiveMinAgo)))
    .orderBy(desc(pagespeedRuns.startedAt))
    .limit(1);

  if (recentRun?.astroCommitSha && recentRun.astroCommitSha === article.astroCommitSha) {
    return c.json(
      {
        ok: false,
        error: "pagespeed_cooldown",
        message:
          "PageSpeed run too recent for unchanged content. Wait 5 minutes or sync new changes first.",
        data: { lastRunAt: recentRun.startedAt.toISOString() },
      },
      429
    );
  }

  const result = await triggerWithPreRunId({
    pipelineName: "article:pagespeed-validation",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    extraInput: { articleId: article.id },
    enqueue: enqueuePagespeedValidationPipeline,
  });
  log.info({ articleId: id, mode: "local", ...result }, "PageSpeed local validation triggered");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/extend-schema", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:schema-extension",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: {
      service: "anthropic",
      estimatedCostEur:
        estimateCostEur("anthropic", COST_OPS.SCHEMA_RICH_DETECTION) +
        estimateCostEur("anthropic", COST_OPS.SCHEMA_FAQ_BUILD) +
        estimateCostEur("anthropic", COST_OPS.SCHEMA_HOWTO_BUILD),
    },
    extraInput: { articleId: article.id },
    enqueue: enqueueSchemaExtensionPipeline,
  });
  log.info({ articleId: id, ...result }, "Schema extension triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── continue (CLI compat) ────────────────────────────────────────────────────

const ContinueBodySchema = z.object({
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

articleRoutes.post("/:articleId/continue", async (c) => {
  const articleId = c.req.param("articleId");
  const rawBody = await c.req.json().catch(() => ({}));
  const bodyResult = ContinueBodySchema.safeParse(rawBody);
  const body = bodyResult.success ? bodyResult.data : {};

  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  try {
    const base = { articleId: article.id, projectId: article.projectId };
    const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
    const result = await continueArticleGeneration(input);
    log.info(
      { articleId, draftJobId: result.draftJobId },
      "Article continuation enqueued via HTTP"
    );
    return c.json({ ok: true, data: result }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: e, articleId }, "Article continuation failed");
    return c.json({ ok: false, error: msg }, 400);
  }
});

// ─── legacy generate (CLI compat, mounted at /api NOT /api/articles) ──────────
// POST /api/projects/:projectSlug/articles/generate starts with /projects/ so it
// cannot live on articleRoutes (mounted at /api/articles). Exported separately
// and mounted at /api in server.ts.

const GenerateBodySchema = z.object({
  cornerstoneSlug: z.string().min(1),
  approvalMode: z.enum(["manual", "auto"]).default("manual"),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

export const legacyArticleRoutes = new Hono();

legacyArticleRoutes.use(requireAuth);

legacyArticleRoutes.post(
  "/projects/:projectSlug/articles/generate",
  zValidator("json", GenerateBodySchema),
  async (c) => {
    const projectSlug = c.req.param("projectSlug");
    const body = c.req.valid("json");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    try {
      const base = {
        cornerstoneSlug: body.cornerstoneSlug,
        projectId: project.id,
        approvalMode: body.approvalMode,
      };
      const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
      const result = await enqueueArticleGeneration(input);
      log.info(
        { projectSlug, cornerstoneSlug: body.cornerstoneSlug, articleId: result.articleId },
        "Article generation enqueued via HTTP"
      );
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(
        { err: e, projectSlug, cornerstoneSlug: body.cornerstoneSlug },
        "Article generation enqueue failed"
      );
      return c.json({ ok: false, error: msg }, 400);
    }
  }
);
