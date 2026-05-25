/**
 * Spec 65.2 — Tool Brand-Asset routes.
 *
 * Powers `/projects/:slug/settings/brand-assets` review queue: list (with
 * filter + stats), edit (colors / canonical name / auto-flip needs_review),
 * re-resolve, upload custom SVG.
 *
 * NOTE: this file is intentionally scoped to `/tool-brand-assets` so it does
 * NOT collide with the Spec-52b `/brand-assets` routes that read/write the
 * older `project_brand_assets` table (different shape, different consumers).
 */
import { zValidator } from "@hono/zod-validator";
import {
  articles,
  countToolsMissingBrandAssets,
  db,
  eq,
  getBrandAssetsForTool,
  getBrandAssetsForTools,
  projects,
  toolBrandAssets,
  upsertBrandAsset,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import {
  MAX_LOGO_BYTES,
  resolveToolBrandAsset,
  uploadCustomLogo,
} from "../../lib/tool-brand-asset-service.ts";

const log = createLogger("routes:tool-brand-assets");

export const toolBrandAssetRoutes = new Hono();
toolBrandAssetRoutes.use(requireAuth);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Toolwiki tools exist as a DE + EN sibling pair (Spec 59.2 bilingual). The
 * `tool_brand_assets.toolId` PK is FK to `articles.id` (per-locale), so
 * without a locale filter the list contains 108 rows for 54 logical tools.
 * V1 fix: pick the project's primary locale (`targetLocales[0]`), strip the
 * BCP-47 region tag (`de-DE` → `de`), fall back to `de`.
 *
 * 65.7+65.8 templates that need a brand-asset for the OTHER locale should
 * traverse the sibling via `translationKey` — V1 deliberately leaves that
 * to the consumer.
 */
function resolvePrimaryLocale(projectTargetLocales: string[] | null): string {
  const first = projectTargetLocales?.[0];
  if (!first) return "de";
  return first.split("-")[0] ?? "de";
}

// ─── GET /api/projects/:slug/tool-brand-assets ───────────────────────────────

const listQuerySchema = z.object({
  needsReview: z
    .union([z.literal("true"), z.literal("false")])
    .optional(),
  source: z.string().optional(),
});

toolBrandAssetRoutes.get(
  "/:slug/tool-brand-assets",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const query = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id, targetLocales: projects.targetLocales })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const primaryLocale = resolvePrimaryLocale(project.targetLocales);

    // Tool-articles in this project's primary locale, LEFT-JOINed with their
    // brand_asset row. We want EVERY tool-article (even those without a row)
    // so Marcel can see + fill the backfill gap.
    const rows = await db
      .select({
        toolId: articles.id,
        toolSlug: articles.slug,
        toolTitle: articles.title,
        toolLocale: articles.locale,
        logoUrl: toolBrandAssets.logoUrl,
        logoWordmarkUrl: toolBrandAssets.logoWordmarkUrl,
        primaryColor: toolBrandAssets.primaryColor,
        secondaryColor: toolBrandAssets.secondaryColor,
        tertiaryColor: toolBrandAssets.tertiaryColor,
        brandNameCanonical: toolBrandAssets.brandNameCanonical,
        source: toolBrandAssets.source,
        needsReview: toolBrandAssets.needsReview,
        fetchedAt: toolBrandAssets.fetchedAt,
        updatedAt: toolBrandAssets.updatedAt,
      })
      .from(articles)
      .leftJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
      .where(
        and(
          eq(articles.projectId, project.id),
          eq(articles.collection, "tools"),
          eq(articles.locale, primaryLocale),
        ),
      )
      .orderBy(sql`${articles.slug} ASC`);

    const filtered = rows.filter((row) => {
      if (query.needsReview === "true" && row.needsReview !== true) return false;
      if (query.needsReview === "false" && row.needsReview === true) return false;
      if (query.source && row.source !== query.source) return false;
      return true;
    });

    const stats = {
      total: rows.length,
      needsReview: rows.filter((r) => r.needsReview === true).length,
      complete: rows.filter((r) => r.needsReview === false).length,
      missing: rows.filter((r) => r.source === null).length,
    };

    const bySource: Record<string, number> = {};
    for (const row of rows) {
      const key = row.source ?? "_missing";
      bySource[key] = (bySource[key] ?? 0) + 1;
    }

    return c.json({
      ok: true,
      data: {
        items: filtered,
        stats,
        bySource,
        primaryLocale,
      },
    });
  },
);

// ─── PATCH /api/projects/:slug/tool-brand-assets/:toolId ─────────────────────
// Marcel edits colors / canonical name / explicit needs_review override. When
// both colors land non-null, auto-flips needs_review=false (Q1 default).

const patchSchema = z.object({
  primaryColor: z.string().regex(HEX_COLOR, "Expected #RRGGBB").nullable().optional(),
  secondaryColor: z.string().regex(HEX_COLOR, "Expected #RRGGBB").nullable().optional(),
  tertiaryColor: z.string().regex(HEX_COLOR, "Expected #RRGGBB").nullable().optional(),
  brandNameCanonical: z.string().min(1).max(200).nullable().optional(),
  needsReview: z.boolean().optional(),
});

toolBrandAssetRoutes.patch(
  "/:slug/tool-brand-assets/:toolId",
  zValidator("json", patchSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const toolId = c.req.param("toolId");
    const body = c.req.valid("json");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    // Confirm the toolId belongs to the project AND is a tool-article. The
    // helper-side guard in upsertBrandAsset enforces the second invariant, but
    // we still need to gate cross-tenant edits at the route boundary.
    const [tool] = await db
      .select({ id: articles.id, title: articles.title })
      .from(articles)
      .where(
        and(
          eq(articles.id, toolId),
          eq(articles.projectId, project.id),
          eq(articles.collection, "tools"),
        ),
      )
      .limit(1);
    if (!tool) {
      return c.json({ ok: false, error: "Tool not found in this project" }, 404);
    }

    // INSERT-or-UPDATE semantics: when no row exists yet (backfill not run),
    // Marcel can still PATCH colors / canonical name and the row is created
    // with sensible defaults. The fields the resolver-chain normally fills
    // (logoUrl, source) are left null + 'manual' so a later re-resolve can
    // populate them without overwriting Marcel's edits.
    const existing = await getBrandAssetsForTool(toolId);

    const newPrimary = body.primaryColor !== undefined ? body.primaryColor : (existing?.primaryColor ?? null);
    const newSecondary =
      body.secondaryColor !== undefined ? body.secondaryColor : (existing?.secondaryColor ?? null);
    const newTertiary =
      body.tertiaryColor !== undefined ? body.tertiaryColor : (existing?.tertiaryColor ?? null);
    const newCanonical =
      body.brandNameCanonical !== undefined
        ? body.brandNameCanonical
        : (existing?.brandNameCanonical ?? tool.title);

    // Auto-flip needs_review=false on save when both colors are filled, unless
    // the caller explicitly set needsReview in the body (Q1 default behavior).
    const colorsBothFilled = newPrimary !== null && newSecondary !== null;
    const newNeedsReview =
      body.needsReview !== undefined
        ? body.needsReview
        : colorsBothFilled
          ? false
          : (existing?.needsReview ?? true);

    const updated = await upsertBrandAsset({
      toolId,
      logoUrl: existing?.logoUrl ?? null,
      logoDarkUrl: existing?.logoDarkUrl ?? null,
      logoWordmarkUrl: existing?.logoWordmarkUrl ?? null,
      primaryColor: newPrimary,
      secondaryColor: newSecondary,
      tertiaryColor: newTertiary,
      brandNameCanonical: newCanonical,
      source: existing?.source ?? "manual",
      needsReview: newNeedsReview,
      fetchedAt: existing?.fetchedAt ?? new Date(),
    });

    log.info(
      { toolId, slug, needsReview: updated.needsReview, created: existing === null },
      "brand asset patched",
    );
    return c.json({ ok: true, data: updated });
  },
);

// ─── POST /api/projects/:slug/tool-brand-assets/:toolId/reresolve ────────────
// Re-runs the chain resolver for this tool. Preserves Marcel-curated colors
// + canonical name — only logoUrl + source change.

toolBrandAssetRoutes.post("/:slug/tool-brand-assets/:toolId/reresolve", async (c) => {
  const slug = c.req.param("slug");
  const toolId = c.req.param("toolId");

  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [tool] = await db
    .select({ id: articles.id, slug: articles.slug, title: articles.title })
    .from(articles)
    .where(
      and(
        eq(articles.id, toolId),
        eq(articles.projectId, project.id),
        eq(articles.collection, "tools"),
      ),
    )
    .limit(1);
  if (!tool) {
    return c.json({ ok: false, error: "Tool not found in this project" }, 404);
  }

  const existing = await getBrandAssetsForTool(toolId);

  const resolved = await resolveToolBrandAsset({
    toolId,
    toolSlug: tool.slug,
    projectId: project.id,
    projectSlug: project.slug,
  });

  // Preserve Marcel-curated fields (Q2: re-resolve never overwrites colors or
  // canonical name). The wordmark URL is freshly pulled from the chain — if
  // the source published a `-text` variant since last run, it lands now.
  const updated = await upsertBrandAsset({
    toolId,
    logoUrl: resolved.logoUrl,
    logoDarkUrl: existing?.logoDarkUrl ?? null,
    logoWordmarkUrl: resolved.logoWordmarkUrl ?? existing?.logoWordmarkUrl ?? null,
    primaryColor: existing?.primaryColor ?? null,
    secondaryColor: existing?.secondaryColor ?? null,
    tertiaryColor: existing?.tertiaryColor ?? null,
    brandNameCanonical: existing?.brandNameCanonical ?? tool.title,
    source: resolved.source,
    needsReview: existing?.needsReview ?? true,
    fetchedAt: new Date(),
  });

  log.info({ toolId, source: resolved.source }, "brand asset re-resolved");
  return c.json({ ok: true, data: updated });
});

// ─── POST /api/projects/:slug/tool-brand-assets/:toolId/upload-logo ──────────
// Multipart-form SVG upload. Source flips to 'manual' so backfill never
// overwrites Marcel's custom logo on a re-resolve.

toolBrandAssetRoutes.post("/:slug/tool-brand-assets/:toolId/upload-logo", async (c) => {
  const slug = c.req.param("slug");
  const toolId = c.req.param("toolId");

  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [tool] = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(
      and(
        eq(articles.id, toolId),
        eq(articles.projectId, project.id),
        eq(articles.collection, "tools"),
      ),
    )
    .limit(1);
  if (!tool) {
    return c.json({ ok: false, error: "Tool not found in this project" }, 404);
  }

  const formData = await c.req.formData().catch(() => null);
  if (!formData) {
    return c.json({ ok: false, error: "Expected multipart/form-data" }, 400);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ ok: false, error: "Missing 'file' field" }, 400);
  }
  if (file.size > MAX_LOGO_BYTES) {
    return c.json(
      { ok: false, error: `File exceeds ${MAX_LOGO_BYTES} bytes (got ${file.size})` },
      413,
    );
  }
  const svgContent = await file.text();

  let upload: Awaited<ReturnType<typeof uploadCustomLogo>>;
  try {
    upload = await uploadCustomLogo({
      toolId,
      projectSlug: project.slug,
      svgContent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 400);
  }

  const existing = await getBrandAssetsForTool(toolId);
  const updated = await upsertBrandAsset({
    toolId,
    logoUrl: upload.logoUrl,
    logoDarkUrl: existing?.logoDarkUrl ?? null,
    primaryColor: existing?.primaryColor ?? null,
    secondaryColor: existing?.secondaryColor ?? null,
    tertiaryColor: existing?.tertiaryColor ?? null,
    brandNameCanonical: existing?.brandNameCanonical ?? tool.title,
    source: "manual",
    needsReview: existing?.needsReview ?? true,
    fetchedAt: new Date(),
  });

  log.info({ toolId, bytes: file.size }, "custom logo uploaded");
  return c.json({ ok: true, data: updated });
});

// ─── GET /api/projects/:slug/tool-brand-assets/missing-count ─────────────────
// Lightweight badge for the Settings menu: how many tools still lack a row.

toolBrandAssetRoutes.get("/:slug/tool-brand-assets/missing-count", async (c) => {
  const slug = c.req.param("slug");
  const [project] = await db
    .select({ id: projects.id, targetLocales: projects.targetLocales })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const primaryLocale = resolvePrimaryLocale(project.targetLocales);
  const missing = await countToolsMissingBrandAssets({
    projectId: project.id,
    locale: primaryLocale,
  });
  return c.json({ ok: true, data: { missing } });
});

// ─── GET /api/projects/:slug/tool-brand-assets/:toolId/usage ─────────────────
// Multi-domain warning helper (Q5): count how many other projects also have a
// tool with the same slug. The PK on tool_brand_assets is `tool_id` which is
// article-scoped (per-project), so "shared assets" really means "other tool-
// articles in other projects with the same slug". Surfaced as an info banner
// in the edit modal so Marcel knows an edit only affects THIS project's row.

toolBrandAssetRoutes.get("/:slug/tool-brand-assets/:toolId/usage", async (c) => {
  const slug = c.req.param("slug");
  const toolId = c.req.param("toolId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [tool] = await db
    .select({ id: articles.id, slug: articles.slug })
    .from(articles)
    .where(
      and(
        eq(articles.id, toolId),
        eq(articles.projectId, project.id),
        eq(articles.collection, "tools"),
      ),
    )
    .limit(1);
  if (!tool) {
    return c.json({ ok: false, error: "Tool not found in this project" }, 404);
  }

  // Sibling tool-articles in OTHER projects that share this slug. Brand asset
  // edits in the current project never touch those rows.
  //
  // Filter must exclude the WHOLE current project, not just the current
  // article — otherwise the EN-locale sibling in this project (Spec 59.2)
  // shows up as "another project" and the multi-domain warning fires
  // spuriously (the bug Marcel surfaced on AnyWord 2026-05-25).
  const sibs = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(
      and(
        eq(articles.slug, tool.slug),
        eq(articles.collection, "tools"),
      ),
    );

  const crossProjectSibs = sibs.filter((s) => s.projectId !== project.id);
  const otherProjectCount = new Set(crossProjectSibs.map((s) => s.projectId)).size;

  // Pre-load their brand asset rows so the UI can show "this is project-local".
  const siblingAssets = await getBrandAssetsForTools(crossProjectSibs.map((s) => s.id));
  return c.json({
    ok: true,
    data: {
      sharedSlug: tool.slug,
      otherProjectCount,
      siblingRowCount: siblingAssets.length,
    },
  });
});
