import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { recalcPillarArticleId } from "./clusters.ts";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import {
  db,
  projects,
  articles,
  clusters,
  contentPillars,
  astroSyncRuns,
  pagespeedRuns,
  schemaExtensionRuns,
  articleVersions,
} from "@marketing-auto/db";
import {
  enqueueArticleGeneration,
  continueArticleGeneration,
  enqueueArticleOutlinePipeline,
  enqueueArticleDraftPipeline,
  enqueueArticleSyncPipeline,
  enqueuePagespeedValidationPipeline,
  enqueueSchemaExtensionPipeline,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { requireAuth } from "../middleware/auth.ts";
import { triggerWithPreRunId, triggerResultToResponse } from "./_lib/trigger-helpers.ts";

const log = createLogger("routes:articles");

export const articleRoutes = new Hono();

articleRoutes.use(requireAuth);

// ─── list ─────────────────────────────────────────────────────────────────────

articleRoutes.get("/articles", async (c) => {
  const projectSlug = c.req.query("projectSlug");
  if (!projectSlug) return c.json({ ok: false, error: "projectSlug required" }, 400);

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db.select({
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
  })
    .from(articles)
    .leftJoin(clusters, eq(articles.clusterId, clusters.id))
    .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
    .where(eq(articles.projectId, project.id))
    .orderBy(desc(articles.updatedAt));

  return c.json({ ok: true, data: rows });
});

// ─── detail ───────────────────────────────────────────────────────────────────

articleRoutes.get("/articles/:id", async (c) => {
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
    db.select().from(astroSyncRuns)
      .where(eq(astroSyncRuns.articleId, id))
      .orderBy(desc(astroSyncRuns.startedAt))
      .limit(5),
    db.select().from(pagespeedRuns)
      .where(eq(pagespeedRuns.articleId, id))
      .orderBy(desc(pagespeedRuns.startedAt))
      .limit(5),
    db.select().from(schemaExtensionRuns)
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
  slug: z.string().min(2).max(200).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum([
    "proposed", "approved", "generating", "outline_review", "drafting",
    "final_review", "schema_extending", "ready_to_publish", "validating",
    "published", "blocked_by_pagespeed", "failed", "rejected",
  ]).optional(),
});

articleRoutes.patch("/articles/:id", zValidator("json", ArticleUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [existing] = await db.select({ id: articles.id, clusterId: articles.clusterId })
    .from(articles).where(eq(articles.id, id)).limit(1);
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

articleRoutes.post("/articles/:id/body", zValidator("json", BodyUpdateSchema), async (c) => {
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

  await db.update(articles)
    .set({
      bodyMd: input.bodyMd,
      wordCount: input.bodyMd.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, id));

  return c.json({ ok: true, data: { version: nextVersion } });
});

// ─── versions list ────────────────────────────────────────────────────────────

articleRoutes.get("/articles/:id/versions", async (c) => {
  const id = c.req.param("id");

  const [exists] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, id)).limit(1);
  if (!exists) return c.json({ ok: false, error: "Article not found" }, 404);

  const versions = await db.select({
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

articleRoutes.get("/articles/:id/versions/:version", async (c) => {
  const id = c.req.param("id");
  const version = parseInt(c.req.param("version"), 10);
  if (isNaN(version)) return c.json({ ok: false, error: "Invalid version number" }, 400);

  const [row] = await db.select().from(articleVersions)
    .where(and(eq(articleVersions.articleId, id), eq(articleVersions.version, version)))
    .limit(1);
  if (!row) return c.json({ ok: false, error: "Version not found" }, 404);

  return c.json({ ok: true, data: row });
});

// ─── pipeline triggers (preRunId pattern) ─────────────────────────────────────

articleRoutes.post("/articles/:id/generate-outline", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select({ id: articles.id, projectId: articles.projectId })
    .from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:outline",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: "outline-generation" },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleOutlinePipeline,
  });
  log.info({ articleId: id, ...result }, "Outline pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/articles/:id/generate-draft", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select({ id: articles.id, projectId: articles.projectId })
    .from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:draft",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: "draft-generation" },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleDraftPipeline,
  });
  log.info({ articleId: id, ...result }, "Draft pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/articles/:id/sync", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select({ id: articles.id, projectId: articles.projectId })
    .from(articles).where(eq(articles.id, id)).limit(1);
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

articleRoutes.post("/articles/:id/validate-pagespeed", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId, astroCommitSha: articles.astroCommitSha })
    .from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  // Cooldown: reject if a run exists within the last 5 minutes with the same commit SHA
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recentRun] = await db
    .select({ startedAt: pagespeedRuns.startedAt, astroCommitSha: pagespeedRuns.astroCommitSha })
    .from(pagespeedRuns)
    .where(and(eq(pagespeedRuns.articleId, id), gte(pagespeedRuns.startedAt, fiveMinAgo)))
    .orderBy(desc(pagespeedRuns.startedAt))
    .limit(1);

  if (recentRun && recentRun.astroCommitSha && recentRun.astroCommitSha === article.astroCommitSha) {
    return c.json({
      ok: false,
      error: "pagespeed_cooldown",
      message: "PageSpeed run too recent for unchanged content. Wait 5 minutes or sync new changes first.",
      data: { lastRunAt: recentRun.startedAt.toISOString() },
    }, 429);
  }

  const result = await triggerWithPreRunId({
    pipelineName: "article:pagespeed-validation",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    extraInput: { articleId: article.id },
    enqueue: enqueuePagespeedValidationPipeline,
  });
  log.info({ articleId: id, ...result }, "PageSpeed validation triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/articles/:id/extend-schema", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select({ id: articles.id, projectId: articles.projectId })
    .from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:schema-extension",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: "schema-extension" },
    extraInput: { articleId: article.id },
    enqueue: enqueueSchemaExtensionPipeline,
  });
  log.info({ articleId: id, ...result }, "Schema extension triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── legacy endpoints (kept for CLI compat) ────────────────────────────────────

const GenerateBodySchema = z.object({
  cornerstoneSlug: z.string().min(1),
  approvalMode: z.enum(["manual", "auto"]).default("manual"),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

const ContinueBodySchema = z.object({
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

articleRoutes.post(
  "/projects/:projectSlug/articles/generate",
  zValidator("json", GenerateBodySchema),
  async (c) => {
    const projectSlug = c.req.param("projectSlug");
    const body = c.req.valid("json");

    const [project] = await db.select().from(projects).where(eq(projects.slug, projectSlug)).limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    try {
      const base = { cornerstoneSlug: body.cornerstoneSlug, projectId: project.id, approvalMode: body.approvalMode };
      const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
      const result = await enqueueArticleGeneration(input);
      log.info({ projectSlug, cornerstoneSlug: body.cornerstoneSlug, articleId: result.articleId }, "Article generation enqueued via HTTP");
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, projectSlug, cornerstoneSlug: body.cornerstoneSlug }, "Article generation enqueue failed");
      return c.json({ ok: false, error: msg }, 400);
    }
  },
);

articleRoutes.post("/articles/:articleId/continue", async (c) => {
  const articleId = c.req.param("articleId");
  const rawBody = await c.req.json().catch(() => ({}));
  const bodyResult = ContinueBodySchema.safeParse(rawBody);
  const body = bodyResult.success ? bodyResult.data : {};

  const [article] = await db.select({ id: articles.id, projectId: articles.projectId })
    .from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  try {
    const base = { articleId: article.id, projectId: article.projectId };
    const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
    const result = await continueArticleGeneration(input);
    log.info({ articleId, draftJobId: result.draftJobId }, "Article continuation enqueued via HTTP");
    return c.json({ ok: true, data: result }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: e, articleId }, "Article continuation failed");
    return c.json({ ok: false, error: msg }, 400);
  }
});
