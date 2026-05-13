import { zValidator } from "@hono/zod-validator";
import { articles, db, projects, socialPosts } from "@marketing-auto/db";
import { enqueueSocialImagePipeline } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
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
  variant: z.enum(["editorial", "stunning"]).default("editorial"),
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
        estimatedCostEur: 0.03,
      },
      enqueue: (input) => {
        const enqueueInput: Parameters<typeof enqueueSocialImagePipeline>[0] = {
          articleId: input.articleId as string,
          projectId: input.projectId as string,
          theme: body.theme,
          variant: body.variant,
        };
        if (input.preRunId) enqueueInput.preRunId = input.preRunId as string;
        return enqueueSocialImagePipeline(enqueueInput);
      },
      extraInput: { articleId, theme: body.theme, variant: body.variant },
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

socialPostDetailRoutes.post("/:id/re-render", async (c) => {
  const id = c.req.param("id");

  const [post] = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.id, id))
    .limit(1);
  if (!post) return c.json({ ok: false, error: "Social post not found" }, 404);
  if (!post.articleId) return c.json({ ok: false, error: "Post has no article" }, 400);

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

  // Mark old post as replaced
  await db
    .update(socialPosts)
    .set({ status: "replaced", updatedAt: new Date() })
    .where(eq(socialPosts.id, id));

  return triggerResultToResponse(c, result);
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

