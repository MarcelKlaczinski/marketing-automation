import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, projects, articles } from "@marketing-auto/db";
import { enqueueArticleGeneration, continueArticleGeneration } from "@marketing-auto/pipelines";
import { enqueueArticleSync } from "@marketing-auto/adapter-astro-sync";
import { enqueueArticleValidation } from "@marketing-auto/adapter-pagespeed";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("routes:articles");

export const articleRoutes = new Hono();

const GenerateBodySchema = z.object({
  cornerstoneSlug: z.string().min(1),
  approvalMode: z.enum(["manual", "auto"]).default("manual"),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

const ContinueBodySchema = z.object({
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

/**
 * POST /api/projects/:projectSlug/articles/generate
 * Enqueues Job 1 (outline pipeline) for a cornerstone keyword.
 * Returns 202 with { ok: true, data: { articleId, outlineJobId, status } }.
 */
articleRoutes.post(
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

    if (!project) {
      return c.json({ ok: false, error: "Project not found" }, 404);
    }

    try {
      const base = {
        cornerstoneSlug: body.cornerstoneSlug,
        projectId: project.id,
        approvalMode: body.approvalMode,
      };
      const input = body.modelOverride
        ? { ...base, modelOverride: body.modelOverride }
        : base;

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

/**
 * POST /api/articles/:articleId/continue
 * Enqueues Job 2 (draft pipeline) for an article in outline_review state.
 * Returns 202 with { ok: true, data: { draftJobId } }.
 * Body is optional — all fields have defaults.
 */
articleRoutes.post(
  "/articles/:articleId/continue",
  async (c) => {
    const articleId = c.req.param("articleId");
    const rawBody = await c.req.json().catch(() => ({}));
    const bodyResult = ContinueBodySchema.safeParse(rawBody);
    const body = bodyResult.success ? bodyResult.data : {};

    const [article] = await db
      .select({ id: articles.id, projectId: articles.projectId })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) {
      return c.json({ ok: false, error: "Article not found" }, 404);
    }

    try {
      const base = {
        articleId: article.id,
        projectId: article.projectId,
      };
      const input = body.modelOverride
        ? { ...base, modelOverride: body.modelOverride }
        : base;

      const result = await continueArticleGeneration(input);
      log.info({ articleId, draftJobId: result.draftJobId }, "Article continuation enqueued via HTTP");
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, articleId }, "Article continuation failed");
      return c.json({ ok: false, error: msg }, 400);
    }
  },
);

/**
 * POST /api/articles/:articleId/sync
 * Enqueues the Astro sync pipeline for a final_review or ready_to_publish article.
 * Returns 202 with { ok: true, data: { syncRunId, jobId } }.
 */
articleRoutes.post(
  "/articles/:articleId/sync",
  async (c) => {
    const articleId = c.req.param("articleId");

    const [article] = await db
      .select({ id: articles.id, projectId: articles.projectId })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) {
      return c.json({ ok: false, error: "Article not found" }, 404);
    }

    try {
      const result = await enqueueArticleSync({
        articleId: article.id,
        projectId: article.projectId,
      });
      log.info({ articleId, syncRunId: result.syncRunId, jobId: result.jobId }, "Astro sync enqueued via HTTP");
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, articleId }, "Astro sync enqueue failed");
      return c.json({ ok: false, error: msg }, 400);
    }
  },
);

/**
 * POST /api/articles/:articleId/validate-pagespeed
 * Enqueues PageSpeed validation for a ready_to_publish or blocked_by_pagespeed article.
 * Returns 202 with { ok: true, data: { pagespeedRunId, jobId } }.
 */
articleRoutes.post(
  "/articles/:articleId/validate-pagespeed",
  async (c) => {
    const articleId = c.req.param("articleId");

    const [article] = await db
      .select({ id: articles.id, projectId: articles.projectId })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) {
      return c.json({ ok: false, error: "Article not found" }, 404);
    }

    try {
      const result = await enqueueArticleValidation({
        articleId: article.id,
        projectId: article.projectId,
      });
      log.info({ articleId, pagespeedRunId: result.pagespeedRunId, jobId: result.jobId }, "PageSpeed validation enqueued via HTTP");
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, articleId }, "PageSpeed validation enqueue failed");
      return c.json({ ok: false, error: msg }, 400);
    }
  },
);
