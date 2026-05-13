import { zValidator } from "@hono/zod-validator";
import { articles, db, socialPosts } from "@marketing-auto/db";
import { enqueueSocialImagePipeline } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { desc, eq } from "drizzle-orm";
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
        };
        if (input.preRunId) enqueueInput.preRunId = input.preRunId as string;
        return enqueueSocialImagePipeline(enqueueInput);
      },
      extraInput: { articleId, theme: body.theme },
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

