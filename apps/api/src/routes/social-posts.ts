import { zValidator } from "@hono/zod-validator";
import { articleDiscovery, articles, db, fetchTemplateOverrides, projects, socialPosts, templateRenders } from "@marketing-auto/db";
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import { readFile } from "node:fs/promises";
import { templateRegistry } from "@marketing-auto/social/templates";
import { enqueueSocialImagePipeline } from "@marketing-auto/pipelines";
import { enqueueSocialRenderJob } from "@marketing-auto/pipelines/social-render-queue";
import { enqueueTemplateRenderJob } from "../workers/discoveryWorker.ts";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, inArray, lt, sql } from "@marketing-auto/db";
import { zipSync } from "fflate";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import { triggerResultToResponse, triggerWithPreRunId } from "./_lib/trigger-helpers.ts";

const log = createLogger("routes:social-posts");

export const socialPostRoutes = new Hono();

socialPostRoutes.use(requireAuth);

// ─── POST /api/articles/:articleId/social-posts/generate ────────────────────

const generateBodySchema = z.object({
  format: z.enum(["list_carousel"]).default("list_carousel"),
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["stunning"]).default("stunning"),
  locales: z.array(z.string().min(2)).min(1).max(5).default(["de-DE"]),
});

socialPostRoutes.post(
  "/:articleId/social-posts/generate",
  zValidator("json", generateBodySchema),
  async (c) => {
    const articleId = c.req.param("articleId");
    const body = c.req.valid("json");

    const [article] = await db
      .select({ id: articles.id, projectId: articles.projectId })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

    const result = await triggerWithPreRunId({
      pipelineName: "article:social-image",
      projectId: article.projectId,
      uniqueKey: { field: "articleId", value: articleId },
      costEstimate: {
        service: "anthropic",
        // €0.028 per locale (one merged caption+hashtag Sonnet call each)
        estimatedCostEur: 0.028 * body.locales.length,
      },
      enqueue: (input) => {
        const enqueueInput: Parameters<typeof enqueueSocialImagePipeline>[0] = {
          articleId: input.articleId as string,
          projectId: input.projectId as string,
          theme: body.theme,
          variant: body.variant,
          locales: body.locales,
        };
        if (input.preRunId) enqueueInput.preRunId = input.preRunId as string;
        return enqueueSocialImagePipeline(enqueueInput);
      },
      extraInput: { articleId, theme: body.theme, variant: body.variant, locales: body.locales },
    });

    return triggerResultToResponse(c, result);
  }
);

// ─── GET /api/articles/:articleId/social-posts ───────────────────────────────

socialPostRoutes.get("/:articleId/social-posts", async (c) => {
  const articleId = c.req.param("articleId");

  const posts = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.articleId, articleId))
    .orderBy(desc(socialPosts.createdAt));

  return c.json({ ok: true, data: posts });
});

// ─── GET /api/social-posts/:id ───────────────────────────────────────────────

export const socialPostDetailRoutes = new Hono();
socialPostDetailRoutes.use(requireAuth);

socialPostDetailRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) return c.json({ ok: false, error: "Social post not found" }, 404);

  return c.json({ ok: true, data: post });
});

// ─── GET /api/social-posts/:id/render-status ────────────────────────────────
// Polling fallback for SSE recovery — returns current render lifecycle state.

socialPostDetailRoutes.get("/:id/render-status", async (c) => {
  const id = c.req.param("id");

  const rows = await db
    .select({
      renderStatus: socialPosts.renderStatus,
      renderStartedAt: socialPosts.renderStartedAt,
      renderCompletedAt: socialPosts.renderCompletedAt,
      renderError: socialPosts.renderError,
      totalSlides: socialPosts.totalSlides,
    })
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ ok: false, error: "Social post not found" }, 404);

  return c.json({ ok: true, data: row });
});

// ─── GET /api/social-posts/:id/download-bundle ──────────────────────────────

socialPostDetailRoutes.get("/:id/download-bundle", async (c) => {
  const id = c.req.param("id");

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);

  if (!post) return c.json({ ok: false, error: "Social post not found" }, 404);

  const content = post.content as {
    kind: "carousel";
    slides: Array<{ imageUrl: string }>;
    caption: string;
    hashtags: string[];
  };

  if (content.kind !== "carousel") {
    return c.json({ ok: false, error: "Only carousel posts support bundle download" }, 400);
  }

  // Build ZIP in memory using Bun
  const slideUrls = content.slides.map((s) => s.imageUrl);

  // Collect slide buffers
  const buffers: { name: string; data: Buffer }[] = [];

  for (let i = 0; i < slideUrls.length; i++) {
    const url = slideUrls[i]!;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      buffers.push({ name: `slide-${String(i + 1).padStart(2, "0")}.png`, data: buf });
    } catch (err) {
      log.warn({ url, err }, "Failed to fetch slide for ZIP bundle");
    }
  }

  // Add caption + hashtags as text files
  buffers.push({
    name: "caption.txt",
    data: Buffer.from(content.caption, "utf-8"),
  });
  buffers.push({
    name: "hashtags.txt",
    data: Buffer.from(content.hashtags.join("\n"), "utf-8"),
  });

  const zipEntries: Record<string, Uint8Array> = {};
  for (const { name, data } of buffers) {
    zipEntries[name] = new Uint8Array(data);
  }
  const zip = zipSync(zipEntries, { level: 0 });

  const [article] = await db
    .select({ slug: articles.slug })
    .from(articles)
    .where(eq(articles.id, post.articleId ?? ""))
    .limit(1);

  const filename = `carousel-${article?.slug ?? id}-${Date.now()}.zip`;

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.byteLength),
    },
  });
});

// ─── POST /api/social-posts/:id/re-render ────────────────────────────────────
// Spec 58.2: re-renders slides using current brand tokens + template overrides.
// Caption and hashtags are preserved as-is. No new social_post row is created.

socialPostDetailRoutes.post("/:id/re-render", async (c) => {
  const id = c.req.param("id");

  // 1. Fetch post
  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);
  if (!post) return c.json({ ok: false, error: "Social post not found" }, 404);

  // 2. Guard: block if a render is already in progress or queued
  if (post.renderStatus === "rendering" || post.renderStatus === "pending") {
    return c.json({ ok: false, error: "Render already in progress" }, 409);
  }

  // 3. Retrieve render input snapshot (persisted by RenderSlidesStep at creation time)
  const content = post.content;
  if (!content || content.kind !== "carousel" || !content.renderInput) {
    return c.json({
      ok: false,
      error: "No render snapshot available for this post. Generate a new post to enable re-render.",
    }, 422);
  }
  const renderInput = content.renderInput;

  // 4. Fetch current brand tokens (live state — key principle: re-render uses CURRENT tokens)
  const [project] = await db
    .select({ brandTokens: projects.brandTokens, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, post.projectId))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  // 5. Fetch current template overrides (live state)
  const { getOverrideSchema, mergeOverrides, isOverrideTemplateKey } = await import("@marketing-auto/social/templates/overrides") as typeof import("@marketing-auto/social/templates/overrides");
  const overrideRow = await fetchTemplateOverrides(post.projectId, renderInput.templateKey);
  const resolvedOverrides = isOverrideTemplateKey(renderInput.templateKey)
    ? mergeOverrides(getOverrideSchema(renderInput.templateKey), overrideRow?.values)
    : {};

  // social_posts.articleId is set at creation time (RenderSlidesStep INSERT); null is not
  // reachable on posts created after Spec 57.2, but guard defensively.
  if (!post.articleId) return c.json({ ok: false, error: "Post has no articleId" }, 400);

  // 6. Reset render lifecycle (preserve caption/hashtags via jsonb_set on slides only)
  await db
    .update(socialPosts)
    .set({
      renderStatus: "pending",
      renderJobId: null,
      renderStartedAt: null,
      renderCompletedAt: null,
      renderError: null,
      totalSlides: 0,
      content: sql`jsonb_set(${socialPosts.content}, '{slides}', '[]'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.id, id));

  // 7. Enqueue render with fresh brand tokens + overrides, stored composition inputs
  // Use timestamp-based jobId so BullMQ doesn't deduplicate against the prior completed job.
  const renderJobId = await enqueueSocialRenderJob(
    {
      socialPostId: id,
      projectId: post.projectId,
      articleId: post.articleId,
      brandTokens: (project.brandTokens ?? {}) as Record<string, unknown>, // Drizzle jsonb → BullMQ payload; structurally compatible
      overrides: resolvedOverrides as Record<string, unknown>, // mergeOverrides returns TemplateOverrides; plain object subset of Record
      ...renderInput,
    },
    { jobId: `rerender-${id}-${Date.now()}` },
  );

  log.info({ socialPostId: id, renderJobId }, "Re-render enqueued");

  return c.json({ ok: true, data: { renderJobId, socialPostId: id } });
});

// ─── POST /api/projects/:slug/social-posts/re-render-batch ───────────────────

export const socialPostBatchRoutes = new Hono();
socialPostBatchRoutes.use(requireAuth);

const batchReRenderBodySchema = z.object({
  socialPostIds: z.array(z.string().uuid()).optional(),
  filter: z
    .object({
      status: z.string().optional(),
      format: z.string().optional(),
      hasEmoji: z.boolean().optional(),
    })
    .optional(),
});

// Date when Spec 52a was deployed — posts before this may have emoji logos
const SPEC_52A_DATE = new Date("2025-05-01T00:00:00Z");

// ─── GET /api/projects/:slug/social-posts (admin list) ───────────────────────

socialPostBatchRoutes.get("/:slug/social-posts", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const postRows = await db
    .select({
      id: socialPosts.id,
      format: socialPosts.format,
      status: socialPosts.status,
      theme: socialPosts.theme,
      createdAt: socialPosts.createdAt,
      articleSlug: articles.slug,
    })
    .from(socialPosts)
    .leftJoin(articles, eq(socialPosts.articleId, articles.id))
    .where(eq(socialPosts.projectId, project.id))
    .orderBy(desc(socialPosts.createdAt))
    .limit(200);

  return c.json({ ok: true, data: { items: postRows } });
});

socialPostBatchRoutes.post("/:slug/social-posts/re-render-batch", async (c) => {
  const slug = c.req.param("slug");
  const rawBody = await c.req.json().catch(() => ({}));
  const body = batchReRenderBodySchema.safeParse(rawBody).data ?? {};

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  let postList: (typeof socialPosts.$inferSelect)[] = [];

  if (body.socialPostIds?.length) {
    postList = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.projectId, project.id),
          inArray(socialPosts.id, body.socialPostIds)
        )
      );
  } else {
    const conditions = [eq(socialPosts.projectId, project.id)];
    if (body.filter?.hasEmoji) {
      conditions.push(lt(socialPosts.createdAt, SPEC_52A_DATE));
    }
    postList = await db
      .select()
      .from(socialPosts)
      .where(and(...conditions))
      .orderBy(desc(socialPosts.createdAt));
  }

  const postsWithArticle = postList.filter((p) => p.articleId);

  const triggered: string[] = [];
  for (const post of postsWithArticle) {
    try {
      const result = await triggerWithPreRunId({
        pipelineName: "article:social-image",
        projectId: post.projectId,
        uniqueKey: { field: "articleId", value: `rerender-${post.articleId}-${Date.now()}` },
        costEstimate: { service: "anthropic", estimatedCostEur: 0.03 },
        enqueue: (input) => {
          const enqueueInput: Parameters<typeof enqueueSocialImagePipeline>[0] = {
            articleId: post.articleId as string,
            projectId: post.projectId,
            theme: post.theme as "dark" | "light",
          };
          if (input.preRunId) enqueueInput.preRunId = input.preRunId as string;
          return enqueueSocialImagePipeline(enqueueInput);
        },
        extraInput: { articleId: post.articleId },
      });

      if (!("error" in result)) {
        await db
          .update(socialPosts)
          .set({ status: "replaced", updatedAt: new Date() })
          .where(eq(socialPosts.id, post.id));
        triggered.push(post.id);
      }
    } catch (err) {
      log.warn({ postId: post.id, err }, "re-render batch: skipping post due to error");
    }
  }

  const estimatedCostEur = triggered.length * 0.03;

  return c.json({
    ok: true,
    data: {
      triggered: triggered.length,
      estimatedCostEur,
    },
  });
});

// ─── GET /api/projects/:slug/social-suggestions ──────────────────────────────
// Articles with pending template suggestions (no ready/rendering renders yet)

socialPostBatchRoutes.get("/:slug/social-suggestions", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      collection: articles.collection,
      locale: articles.locale,
      suggestedTemplates: articleDiscovery.suggestedTemplates,
    })
    .from(articles)
    .innerJoin(articleDiscovery, eq(articleDiscovery.articleId, articles.id))
    .where(
      and(
        eq(articles.projectId, project.id),
        inArray(articles.source, ["generated", "imported"]),
        // Only articles that have non-empty suggestions
        // handled below via filter — avoids jsonb_array_length in WHERE for portability
      )
    )
    .orderBy(desc(articles.updatedAt))
    .limit(100);

  // Filter to articles with actual suggestions
  const hasSuggestions = rows.filter(
    (r) => Array.isArray(r.suggestedTemplates) && r.suggestedTemplates.length > 0
  );

  if (hasSuggestions.length === 0) {
    return c.json({ ok: true, data: { items: [] } });
  }

  // Articles that already have a ready or rendering render
  const articleIdsWithSuggestions = hasSuggestions.map((r) => r.id);
  const renderedRows = await db
    .select({ articleId: templateRenders.articleId })
    .from(templateRenders)
    .where(
      and(
        inArray(templateRenders.articleId, articleIdsWithSuggestions),
        inArray(templateRenders.status, ["ready", "rendering"]),
      )
    );
  const renderedArticleIds = new Set(renderedRows.map((r) => r.articleId));

  const withSuggestions = hasSuggestions
    .filter((r) => !renderedArticleIds.has(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      collection: r.collection,
      locale: r.locale,
      suggestions: r.suggestedTemplates,
    }));

  return c.json({ ok: true, data: { items: withSuggestions } });
});

// ─── GET /api/articles/:articleId/template-suggestions ───────────────────────
// Per-article: returns suggestedTemplates + current render statuses

socialPostRoutes.get("/:articleId/template-suggestions", async (c) => {
  const articleId = c.req.param("articleId");

  const [discovery] = await db
    .select({ suggestedTemplates: articleDiscovery.suggestedTemplates })
    .from(articleDiscovery)
    .where(eq(articleDiscovery.articleId, articleId))
    .limit(1);

  const suggestions = discovery?.suggestedTemplates ?? [];

  const renders = await db
    .select({ templateKey: templateRenders.templateKey, status: templateRenders.status })
    .from(templateRenders)
    .where(eq(templateRenders.articleId, articleId));

  const renderByKey: Record<string, string> = {};
  for (const r of renders) {
    if (r.templateKey) renderByKey[r.templateKey] = r.status;
  }

  return c.json({ ok: true, data: { suggestions, renders: renderByKey } });
});

// ─── GET /api/articles/:articleId/all-templates ──────────────────────────────
// All registered templates with eligibility + latest render status + slide URLs

socialPostRoutes.get("/:articleId/all-templates", async (c) => {
  const articleId = c.req.param("articleId");

  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [discovery] = await db
    .select()
    .from(articleDiscovery)
    .where(eq(articleDiscovery.articleId, articleId))
    .limit(1);

  // Most recent render per template key (ordered newest-first)
  const renderRows = await db
    .select()
    .from(templateRenders)
    .where(eq(templateRenders.articleId, articleId))
    .orderBy(desc(templateRenders.createdAt));

  const renderByKey: Record<string, typeof templateRenders.$inferSelect> = {};
  for (const r of renderRows) {
    if (r.templateKey && !(r.templateKey in renderByKey)) {
      renderByKey[r.templateKey] = r;
    }
  }

  const allTemplates = templateRegistry.list();

  const result = allTemplates.map((t) => {
    const eligibility = discovery
      ? t.eligibility(article as Article, discovery as ArticleDiscovery)
      : ({ eligible: false, reason: "Discovery not yet run" } as { eligible: false; reason: string });

    const render = renderByKey[t.key] ?? null;

    let slides: Array<{ imageUrl: string }> | null = null;
    if (render?.status === "ready" && render.outputFiles) {
      const out = render.outputFiles;
      if (Array.isArray(out?.slides)) {
        slides = out.slides
          .map((s) => {
            const parts = s.filePath.split("renders/");
            return parts[1] ? { imageUrl: `/renders/${parts[1]}` } : null;
          })
          .filter((s): s is { imageUrl: string } => s !== null);
      }
    }

    return {
      templateKey: t.key,
      displayName: t.displayName,
      description: t.description,
      estimatedCostUsd: t.estimatedCostUsd,
      eligible: eligibility.eligible,
      ineligibleReason: !eligibility.eligible
        ? (eligibility as { eligible: false; reason?: string }).reason
        : undefined,
      renderStatus: render?.status ?? null,
      renderId: render?.id ?? null,
      slides,
      completedAt: render?.completedAt?.toISOString() ?? null,
    };
  });

  return c.json({ ok: true, data: { templates: result } });
});

// ─── POST /api/articles/:articleId/generate-templates ────────────────────────
// Enqueue BullMQ render jobs for one or more templateKeys

const generateTemplatesBodySchema = z.object({
  templateKeys: z.array(z.string()).min(1),
  locale: z.enum(["de", "en"]).default("de"),
  theme: z.enum(["dark", "light"]).default("dark"),
});

socialPostRoutes.post(
  "/:articleId/generate-templates",
  zValidator("json", generateTemplatesBodySchema),
  async (c) => {
    const articleId = c.req.param("articleId");
    const body = c.req.valid("json");

    const [article] = await db
      .select({
        id: articles.id,
        projectId: articles.projectId,
        slug: articles.slug,
        title: articles.title,
        collection: articles.collection,
        locale: articles.locale,
        translationKey: articles.translationKey,
        frontmatterExtras: articles.frontmatterExtras,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

    // When the requested locale differs from the article's locale, use the sibling article's
    // content for buildInput so the rendered slides contain the correct language.
    let contentArticle: typeof article = article;
    if (body.locale !== article.locale && article.translationKey) {
      const [sibling] = await db
        .select({
          id: articles.id,
          projectId: articles.projectId,
          slug: articles.slug,
          title: articles.title,
          collection: articles.collection,
          locale: articles.locale,
          translationKey: articles.translationKey,
          frontmatterExtras: articles.frontmatterExtras,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, article.projectId),
            eq(articles.translationKey, article.translationKey),
            eq(articles.locale, body.locale),
          )
        )
        .limit(1);
      if (sibling) contentArticle = sibling;
    }

    const [discovery] = await db
      .select()
      .from(articleDiscovery)
      .where(eq(articleDiscovery.articleId, articleId))
      .limit(1);

    const jobs: Array<{ templateKey: string; status: "queued" | "skipped"; reason?: string; jobId?: string; renderId?: string }> = [];

    for (const templateKey of body.templateKeys) {
      let template;
      try {
        template = templateRegistry.getById(templateKey as import("@marketing-auto/social/templates").TemplateKey);
      } catch {
        jobs.push({ templateKey, status: "skipped", reason: "Template not registered" });
        continue;
      }

      if (!discovery) {
        jobs.push({ templateKey, status: "skipped", reason: "Discovery not yet run for this article" });
        continue;
      }

      const eligibility = template.eligibility(
        contentArticle as import("@marketing-auto/db").Article,
        discovery as import("@marketing-auto/db").ArticleDiscovery,
      );
      if (!eligibility.eligible) {
        const skipEntry: { templateKey: string; status: "skipped"; reason?: string } = { templateKey, status: "skipped" };
        if (eligibility.reason) skipEntry.reason = eligibility.reason;
        jobs.push(skipEntry);
        continue;
      }

      // Build render input (may do DB lookups for tool data)
      let renderInput: Record<string, unknown>;
      try {
        renderInput = (await template.buildInput(
          contentArticle as import("@marketing-auto/db").Article,
          discovery as import("@marketing-auto/db").ArticleDiscovery,
        )) as Record<string, unknown>;
      } catch (err) {
        jobs.push({ templateKey, status: "skipped", reason: `buildInput failed: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }

      // Supersede any active rows (pending/rendering/ready) so the partial unique index
      // allows the new INSERT. Old rows are kept with status="superseded" for history.
      await db
        .update(templateRenders)
        .set({ status: "superseded" })
        .where(
          and(
            eq(templateRenders.articleId, articleId),
            eq(templateRenders.templateKey, templateKey),
            eq(templateRenders.locale, body.locale),
            eq(templateRenders.theme, body.theme),
            inArray(templateRenders.status, ["pending", "rendering", "ready"]),
          )
        );

      const [insertedRow] = await db
        .insert(templateRenders)
        .values({
          articleId,
          templateKey,
          locale: body.locale,
          theme: body.theme,
          status: "pending",
          renderInput,
        })
        .returning({ id: templateRenders.id });

      if (!insertedRow) {
        jobs.push({ templateKey, status: "skipped", reason: "DB insert failed" });
        continue;
      }

      const renderId = insertedRow.id;

      const { jobId } = await enqueueTemplateRenderJob(renderId);
      jobs.push({ templateKey, status: "queued", jobId, renderId });
    }

    const queued = jobs.filter((j) => j.status === "queued").length;
    log.info({ articleId, queued, total: jobs.length }, "generate-templates: jobs enqueued");
    return c.json({ ok: true, data: { jobs } }, queued > 0 ? 202 : 200);
  }
);


// ─── GET /api/articles/:articleId/template-renders ───────────────────────────
// Full render history: ALL rows for this article, newest first, with slide URLs.

socialPostRoutes.get("/:articleId/template-renders", async (c) => {
  const articleId = c.req.param("articleId");

  const rows = await db
    .select()
    .from(templateRenders)
    .where(eq(templateRenders.articleId, articleId))
    .orderBy(desc(templateRenders.createdAt));

  const allTemplates = templateRegistry.list();
  const displayNameByKey = Object.fromEntries(allTemplates.map((t) => [t.key, t.displayName]));

  const data = rows.map((r) => {
    let slides: Array<{ imageUrl: string }> | null = null;
    if (r.status === "ready" && r.outputFiles) {
      const out = r.outputFiles;
      if (Array.isArray(out?.slides)) {
        slides = out.slides
          .map((s) => {
            const parts = s.filePath.split("renders/");
            return parts[1] ? { imageUrl: `/renders/${parts[1]}` } : null;
          })
          .filter((s): s is { imageUrl: string } => s !== null);
      }
    }

    return {
      id: r.id,
      templateKey: r.templateKey,
      displayName: r.templateKey ? (displayNameByKey[r.templateKey] ?? r.templateKey) : r.templateKey,
      locale: r.locale,
      theme: r.theme,
      status: r.status,
      slides,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      error: r.error,
      createdAt: r.createdAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    };
  });

  return c.json({ ok: true, data: { renders: data } });
});

// ─── GET /api/template-renders/:id/download ──────────────────────────────────

export const templateRenderDetailRoutes = new Hono();
templateRenderDetailRoutes.use(requireAuth);

templateRenderDetailRoutes.get("/:id/download", async (c) => {
  const id = c.req.param("id");

  const [render] = await db
    .select()
    .from(templateRenders)
    .where(eq(templateRenders.id, id))
    .limit(1);

  if (!render) return c.json({ ok: false, error: "Template render not found" }, 404);
  if (render.status !== "ready") return c.json({ ok: false, error: "Render not ready" }, 400);

  const out = render.outputFiles;
  if (!out?.slides?.length) return c.json({ ok: false, error: "No output files" }, 400);

  const zipEntries: Record<string, Uint8Array> = {};

  for (let i = 0; i < out.slides.length; i++) {
    const slide = out.slides[i]!;
    try {
      const buf = await readFile(slide.filePath);
      zipEntries[`slide-${String(i + 1).padStart(2, "0")}.png`] = new Uint8Array(buf);
    } catch {
      log.warn({ filePath: slide.filePath }, "Slide file missing — skipping");
    }
  }

  if (out.caption) {
    zipEntries["caption.txt"] = new TextEncoder().encode(out.caption);
  }
  if (out.hashtags?.length) {
    zipEntries["hashtags.txt"] = new TextEncoder().encode(out.hashtags.join("\n"));
  }

  const zip = zipSync(zipEntries, { level: 0 });

  const slug = render.articleId
    ? (await db.select({ slug: articles.slug }).from(articles).where(eq(articles.id, render.articleId)).limit(1))[0]?.slug
    : null;

  const filename = `${render.templateKey}-${slug ?? id}-${render.locale}-${render.theme}.zip`;

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.byteLength),
    },
  });
});
