import { zValidator } from "@hono/zod-validator";
import { articles, db, socialPosts } from "@marketing-auto/db";
import { enqueueSocialImagePipeline } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { desc, eq } from "drizzle-orm";
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

  // Build ZIP manually (simple stored ZIP, no compression)
  const zip = buildZip(buffers);

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

// ─── Minimal stored ZIP builder ───────────────────────────────────────────────

function buildZip(files: { name: string; data: Buffer }[]): Uint8Array {
  // Uses Bun.ArrayBufferSink for concatenation
  // Implements ZIP spec (PKZIP stored, no compression) for compatibility
  const localHeaders: { offset: number; name: string; crc: number; size: number }[] = [];
  const parts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf-8");
    const crc = crc32(file.data);
    const size = file.data.length;

    // Local file header
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0);  // signature
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0, 6);            // flags
    lh.writeUInt16LE(0, 8);            // compression: stored
    lh.writeUInt16LE(0, 10);           // mod time
    lh.writeUInt16LE(0, 12);           // mod date
    lh.writeUInt32LE(crc, 14);         // crc-32
    lh.writeUInt32LE(size, 18);        // compressed size
    lh.writeUInt32LE(size, 22);        // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBytes.copy(lh, 30);

    localHeaders.push({ offset, name: file.name, crc, size });
    parts.push(lh, file.data);
    offset += lh.length + size;
  }

  const cdOffset = offset;
  const cdParts: Buffer[] = [];

  for (const { offset: lhOffset, name, crc, size } of localHeaders) {
    const nameBytes = Buffer.from(name, "utf-8");
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);   // central dir signature
    cd.writeUInt16LE(20, 4);            // version made by
    cd.writeUInt16LE(20, 6);            // version needed
    cd.writeUInt16LE(0, 8);             // flags
    cd.writeUInt16LE(0, 10);            // compression
    cd.writeUInt16LE(0, 12);            // mod time
    cd.writeUInt16LE(0, 14);            // mod date
    cd.writeUInt32LE(crc, 16);          // crc
    cd.writeUInt32LE(size, 20);         // compressed
    cd.writeUInt32LE(size, 24);         // uncompressed
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(lhOffset, 42);
    nameBytes.copy(cd, 46);
    cdParts.push(cd);
  }

  const cdSize = cdParts.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  const all = [...parts, ...cdParts, eocd];
  const total = all.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const b of all) {
    result.set(b, pos);
    pos += b.length;
  }
  return result;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  const table = getCrcTable();
  for (const byte of buf) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[i] = c;
  }
  return _crcTable;
}
