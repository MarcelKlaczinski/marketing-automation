import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets, projects, type ProjectBrandAsset } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import {
  brandTokensSchema,
  type BrandTokens,
  DEFAULT_BRAND_TOKENS,
} from "@marketing-auto/shared/brand-tokens";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_SLUG_TO_LOBE } from "./tool-icon-mapping.ts";

const log = createLogger("brand-asset-service");

// Spec 60.0: canonical schema from @marketing-auto/shared/brand-tokens.
// Re-exported here so existing imports from this file don't break.
export { brandTokensSchema, type BrandTokens };
export type ParsedBrandTokens = BrandTokens;

// ─── Resolved icon / logo shapes ─────────────────────────────────────────────

export type ResolvedIcon =
  | { type: "path"; filePath: string; sourceRef: string }   // lobe-icons: absolute path to PNG
  | { type: "url"; url: string }                             // r2 or external URL
  | { type: "svg"; svg: string }                             // inline SVG
  | { type: "wordmark"; text: string }                       // text-only logo / domain wordmark
  | { type: "avatar"; initials: string; hue: number };      // deterministic HSL fallback

// ─── lobe-icons path resolution ──────────────────────────────────────────────

const LOBE_ICONS_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../node_modules/@lobehub/icons-static-png"
);

function lobeIconPath(slug: string, theme: "dark" | "light", variant?: "color" | "text"): string {
  const suffix = variant ? `-${variant}` : "";
  return resolve(LOBE_ICONS_BASE, theme, `${slug}${suffix}.png`);
}

async function findLobeIcon(slug: string, theme: "dark" | "light"): Promise<string | null> {
  // Prefer -color variant, fall back to plain
  for (const variant of ["color", undefined] as const) {
    const p = lobeIconPath(slug, theme, variant as "color" | undefined);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

export function getLobeIconRef(slug: string): string {
  return `${slug}-color`;
}

// ─── Deterministic HSL avatar ─────────────────────────────────────────────────

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Spec 60.0: canonical defaults now come from brandTokensSchema.parse({}).
// DEFAULT_TYPOGRAPHY is kept for back-compat (used in brand-tokens.ts route response).
export const DEFAULT_TYPOGRAPHY: BrandTokens["typography"] = DEFAULT_BRAND_TOKENS.typography;

export async function getBrandTokens(projectId: string): Promise<ParsedBrandTokens> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { brandTokens: true },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  // brandTokensSchema.parse() applies all defaults — no manual merge needed (Spec 60.0)
  return brandTokensSchema.parse(project.brandTokens ?? {});
}

export async function resolveToolIcon(
  projectId: string,
  toolSlug: string,
  theme: "dark" | "light" = "dark"
): Promise<ResolvedIcon> {
  // 1. Look up DB asset record
  const asset = await db.query.projectBrandAssets.findFirst({
    where: and(
      eq(projectBrandAssets.projectId, projectId),
      eq(projectBrandAssets.assetType, "tool_icon"),
      eq(projectBrandAssets.assetKey, toolSlug)
    ),
  });

  if (asset) {
    if (asset.source === "lobe-icons" && asset.sourceRef) {
      const lobeSlug = asset.sourceRef.replace(/-color$|-text$/, "");
      const filePath = await findLobeIcon(lobeSlug, theme);
      if (filePath) return { type: "path", filePath, sourceRef: asset.sourceRef };
    }
    if (asset.source === "r2" && asset.sourceRef) {
      return { type: "url", url: `https://pub.toolwiki.ai/${asset.sourceRef}` };
    }
    if (asset.source === "inline-svg" && asset.inlineSvg) {
      return { type: "svg", svg: asset.inlineSvg };
    }
  }

  // 2. Try resolving via lobe-icons directly (without a DB record)
  const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;
  const filePath = await findLobeIcon(lobeSlug, theme);
  if (filePath) {
    log.debug({ toolSlug, lobeSlug, theme }, "resolved tool icon via lobe-icons (no DB record)");
    return { type: "path", filePath, sourceRef: getLobeIconRef(lobeSlug) };
  }

  // 3. Deterministic avatar fallback
  log.debug({ toolSlug }, "no icon found — using deterministic avatar");
  return {
    type: "avatar",
    initials: toolSlug.slice(0, 2).toUpperCase(),
    hue: hashToHue(toolSlug),
  };
}

export async function getProjectAssets(
  projectId: string,
  assetType?: string
): Promise<ProjectBrandAsset[]> {
  const conditions = [eq(projectBrandAssets.projectId, projectId)];
  if (assetType) conditions.push(eq(projectBrandAssets.assetType, assetType));
  return db.query.projectBrandAssets.findMany({ where: and(...conditions) });
}

export async function upsertBrandAsset(
  asset: Omit<typeof projectBrandAssets.$inferInsert, "id" | "createdAt" | "updatedAt">
): Promise<ProjectBrandAsset> {
  // Build the update set conditionally to satisfy exactOptionalPropertyTypes
  const updateSet: Record<string, unknown> = {
    source: asset.source,
    metadata: asset.metadata ?? {},
    updatedAt: new Date(),
  };
  if (asset.sourceRef !== undefined) updateSet.sourceRef = asset.sourceRef;
  if (asset.inlineSvg !== undefined) updateSet.inlineSvg = asset.inlineSvg;
  if (asset.displayName !== undefined) updateSet.displayName = asset.displayName;

  const rows = await db
    .insert(projectBrandAssets)
    .values(asset)
    .onConflictDoUpdate({
      target: [projectBrandAssets.projectId, projectBrandAssets.assetType, projectBrandAssets.assetKey],
      // biome-ignore lint/suspicious/noExplicitAny: conditional build for exactOptionalPropertyTypes
      set: updateSet as any,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertBrandAsset: no row returned");
  return row;
}

async function findLogoAsset(
  projectId: string,
  assetKey: string
): Promise<ProjectBrandAsset | null> {
  const asset = await db.query.projectBrandAssets.findFirst({
    where: and(
      eq(projectBrandAssets.projectId, projectId),
      eq(projectBrandAssets.assetType, "logo"),
      eq(projectBrandAssets.assetKey, assetKey)
    ),
  });
  return asset ?? null;
}

export async function resolveLogo(projectId: string, theme: "dark" | "light" = "dark"): Promise<ResolvedIcon> {
  const tokens = await getBrandTokens(projectId);
  const logoKey = tokens.social?.logoAssetKey ?? "main";
  const oppositeTheme = theme === "dark" ? "light" : "dark";

  // Spec 65.15: theme-variant lookup with single-variant fallback. Tries
  // `<key>-<theme>` → base key → `<key>-<oppositeTheme>` so Marcel can upload
  // just ONE logo variant and it works for both themes.
  const asset =
    (await findLogoAsset(projectId, `${logoKey}-${theme}`)) ??
    (await findLogoAsset(projectId, logoKey)) ??
    (await findLogoAsset(projectId, `${logoKey}-${oppositeTheme}`));

  if (asset) {
    if (asset.source === "wordmark" && asset.sourceRef) {
      return { type: "wordmark", text: asset.sourceRef };
    }
    if (asset.source === "inline-svg" && asset.inlineSvg) {
      return { type: "svg", svg: asset.inlineSvg };
    }
    if (asset.source === "r2" && asset.sourceRef) {
      return { type: "url", url: `https://pub.toolwiki.ai/${asset.sourceRef}` };
    }
    if (asset.source === "lobe-icons" && asset.sourceRef) {
      const lobeSlug = asset.sourceRef.replace(/-color$|-text$/, "");
      const filePath = await findLobeIcon(lobeSlug, theme);
      if (filePath) return { type: "path", filePath, sourceRef: asset.sourceRef };
    }
  }

  // Fallback: domain as wordmark
  const fallbackText = tokens.social?.websiteUrl ?? tokens.social?.instagramHandle ?? projectId;
  log.debug({ projectId, logoKey }, "no logo asset found — using websiteUrl fallback");
  return { type: "wordmark", text: fallbackText };
}

/**
 * Spec 65.15 — Resolve a project's logo as a URL string ready for an `<Img>` src.
 *
 * Picks a theme-aware variant (`<logoAssetKey>-<theme>`) first, falls back to the
 * base key. Returns `null` when no usable asset exists so the brand-stamp can
 * gracefully render nothing (rather than a broken-image or a wordmark — wordmarks
 * are not watermark-shaped).
 *
 * Supported source types:
 *   - `r2`         → public R2 URL
 *   - `inline-svg` → `data:image/svg+xml;base64,…` data URL
 *
 * Skipped (return null):
 *   - `wordmark` / `lobe-icons` — neither is appropriate as a corner watermark
 */
export async function resolveLogoUrl(
  projectId: string,
  theme: "dark" | "light" = "dark"
): Promise<string | null> {
  const tokens = await getBrandTokens(projectId);
  const logoKey = tokens.social?.logoAssetKey ?? "main";
  const oppositeTheme = theme === "dark" ? "light" : "dark";

  // Marcel-Decision Q2: single-variant fallback — if only one variant uploaded,
  // use it for both themes. Chain: <key>-<theme> → <key> → <key>-<oppositeTheme>.
  const asset =
    (await findLogoAsset(projectId, `${logoKey}-${theme}`)) ??
    (await findLogoAsset(projectId, logoKey)) ??
    (await findLogoAsset(projectId, `${logoKey}-${oppositeTheme}`));

  if (!asset) return null;

  if (asset.source === "r2" && asset.sourceRef) {
    return `https://pub.toolwiki.ai/${asset.sourceRef}`;
  }
  if (asset.source === "inline-svg" && asset.inlineSvg) {
    const base64 = Buffer.from(asset.inlineSvg, "utf-8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  }

  return null;
}

// Re-export for use in seed script
export { findLobeIcon, TOOL_SLUG_TO_LOBE, LOBE_ICONS_BASE };
