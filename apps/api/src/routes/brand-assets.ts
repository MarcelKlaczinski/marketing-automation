import { zValidator } from "@hono/zod-validator";
import { db, projectBrandAssets, projects } from "@marketing-auto/db";
import { r2 } from "@marketing-auto/adapter-storage";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import {
  upsertBrandAsset,
  getProjectAssets,
} from "../lib/brand-asset-service.ts";
import { resolveToolIcon } from "../lib/icon-resolver.ts";

const log = createLogger("routes:brand-assets");

export const brandAssetRoutes = new Hono();
brandAssetRoutes.use(requireAuth);

// ─── Helper: resolve preview URL for an asset ────────────────────────────────

function assetPreviewUrl(asset: typeof projectBrandAssets.$inferSelect): string {
  if (asset.r2Key) {
    // Custom upload: public R2 URL
    return `${process.env["R2_PUBLIC_BASE_URL"] ?? ""}/${asset.r2Key}`;
  }
  if (asset.inlineSvg) {
    // Inline SVG: data URI for preview
    const encoded = encodeURIComponent(asset.inlineSvg);
    return `data:image/svg+xml,${encoded}`;
  }
  return "";
}

// ─── GET /api/projects/:slug/brand-assets ────────────────────────────────────

const listQuerySchema = z.object({
  assetType: z.string().optional(),
  source: z.string().optional(),
});

brandAssetRoutes.get(
  "/:slug/brand-assets",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const query = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const allAssets = await getProjectAssets(project.id, query.assetType);

    const filtered = query.source
      ? allAssets.filter((a) => a.source === query.source)
      : allAssets;

    const bySource: Record<string, number> = {};
    for (const a of filtered) {
      bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    }

    const assets = filtered.map((a) => ({
      ...a,
      previewUrl: assetPreviewUrl(a),
    }));

    return c.json({
      ok: true,
      data: {
        assets,
        summary: { total: assets.length, bySource },
      },
    });
  }
);

// ─── POST /api/projects/:slug/brand-assets/upload ────────────────────────────

brandAssetRoutes.post("/:slug/brand-assets/upload", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ ok: false, error: "Expected multipart/form-data" }, 400);

  const file = formData.get("file");
  const assetType = formData.get("assetType");
  const assetKey = formData.get("assetKey");
  const displayName = formData.get("displayName");

  if (!(file instanceof File)) return c.json({ ok: false, error: "file is required" }, 400);
  if (typeof assetType !== "string" || !["tool_icon", "logo"].includes(assetType)) {
    return c.json({ ok: false, error: "assetType must be tool_icon or logo" }, 400);
  }
  if (typeof assetKey !== "string" || !assetKey.trim()) {
    return c.json({ ok: false, error: "assetKey is required" }, 400);
  }

  const allowedTypes = ["image/svg+xml", "image/png", "image/jpeg"];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ ok: false, error: "Only SVG, PNG, and JPEG files are allowed" }, 400);
  }

  const MAX_SIZE = 500 * 1024; // 500 KB
  if (file.size > MAX_SIZE) {
    return c.json({ ok: false, error: "File exceeds 500 KB limit" }, 400);
  }

  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : "jpg";
  const r2Key = `assets/${project.id}/${assetType}/${assetKey.trim()}-${Date.now()}.${ext}`;

  const buffer = await file.arrayBuffer();

  try {
    await r2.put({ key: r2Key, body: Buffer.from(buffer), contentType: file.type });
  } catch (err) {
    log.error({ err, r2Key }, "R2 upload failed");
    return c.json({ ok: false, error: "Upload to storage failed" }, 500);
  }

  const inlineSvg =
    file.type === "image/svg+xml"
      ? new TextDecoder().decode(buffer)
      : undefined;

  const assetValues: Parameters<typeof upsertBrandAsset>[0] = {
    projectId: project.id,
    assetType,
    assetKey: assetKey.trim(),
    source: "custom-upload",
    r2Key,
    metadata: {},
  };
  if (inlineSvg !== undefined) assetValues.inlineSvg = inlineSvg;
  if (typeof displayName === "string" && displayName.trim()) {
    assetValues.displayName = displayName.trim();
  }

  const asset = await upsertBrandAsset(assetValues);

  return c.json({
    ok: true,
    data: { asset, previewUrl: assetPreviewUrl(asset) },
  });
});

// ─── DELETE /api/projects/:slug/brand-assets/:assetId ────────────────────────

brandAssetRoutes.delete("/:slug/brand-assets/:assetId", async (c) => {
  const slug = c.req.param("slug");
  const assetId = c.req.param("assetId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [asset] = await db
    .select()
    .from(projectBrandAssets)
    .where(
      and(eq(projectBrandAssets.id, assetId), eq(projectBrandAssets.projectId, project.id))
    )
    .limit(1);
  if (!asset) return c.json({ ok: false, error: "Asset not found" }, 404);

  if (asset.source === "custom-upload" && asset.r2Key) {
    await r2.delete(asset.r2Key);
  }

  await db
    .delete(projectBrandAssets)
    .where(eq(projectBrandAssets.id, assetId));

  log.info({ assetId, assetKey: asset.assetKey }, "brand asset deleted");

  return c.json({ ok: true, data: { deleted: true, willResolve: "auto" } });
});

// ─── POST /api/projects/:slug/brand-assets/:assetId/reset ────────────────────

brandAssetRoutes.post("/:slug/brand-assets/:assetId/reset", async (c) => {
  const slug = c.req.param("slug");
  const assetId = c.req.param("assetId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [asset] = await db
    .select()
    .from(projectBrandAssets)
    .where(
      and(eq(projectBrandAssets.id, assetId), eq(projectBrandAssets.projectId, project.id))
    )
    .limit(1);
  if (!asset) return c.json({ ok: false, error: "Asset not found" }, 404);

  if (asset.source === "custom-upload" && asset.r2Key) {
    await r2.delete(asset.r2Key);
  }

  // Delete the cached row — next resolveToolIcon call re-runs the resolution chain
  await db
    .delete(projectBrandAssets)
    .where(eq(projectBrandAssets.id, assetId));

  // Re-resolve immediately to rebuild the cache
  let newAsset: (typeof projectBrandAssets.$inferSelect) | null = null;
  if (asset.assetType === "tool_icon") {
    await resolveToolIcon(project.id, asset.assetKey);
    const rows = await db
      .select()
      .from(projectBrandAssets)
      .where(
        and(
          eq(projectBrandAssets.projectId, project.id),
          eq(projectBrandAssets.assetType, "tool_icon"),
          eq(projectBrandAssets.assetKey, asset.assetKey)
        )
      )
      .limit(1);
    newAsset = rows[0] ?? null;
  }

  return c.json({ ok: true, data: { newAsset } });
});
