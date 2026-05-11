import { zValidator } from "@hono/zod-validator";
import { COST_OPS, estimateCostEur } from "@marketing-auto/core";
import {
  articleVersions,
  articles,
  astroSyncRuns,
  clusters,
  contentPillars,
  db,
  pagespeedRuns,
  projects,
  schemaExtensionRuns,
} from "@marketing-auto/db";
import {
  continueArticleGeneration,
  enqueueArticleDraftPipeline,
  enqueueArticleGenerationLegacy as enqueueArticleGeneration,
  enqueueArticleOutlinePipeline,
  enqueueArticleSyncPipeline,
  enqueuePagespeedApiValidationPipeline,
  enqueuePagespeedValidationPipeline,
  enqueueSchemaExtensionPipeline,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
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
  lane: z.string().optional(),
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
  if (q.lane) conditions.push(eq(articles.status, q.lane as ArticleStatus));
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
          sql`${articles.id} != ${id}`
        )
      )
      .limit(1);
    pendant = p ?? null;
  }

  return c.json({ ok: true, data: { article, pendant } });
});

// ─── detail ───────────────────────────────────────────────────────────────────

articleRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [cluster] = article.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1)
    : [null];

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

  return c.json({
    ok: true,
    data: {
      article,
      cluster,
      pillar,
      recentRuns: {
        sync: recentSync,
        pagespeed: recentPagespeed,
        schema: recentSchema,
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
