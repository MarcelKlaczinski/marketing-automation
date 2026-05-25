import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets } from "@marketing-auto/db";
import { simpleIconsAdapter } from "./icon-sources/simple-icons.ts";
import { iconifyAdapter } from "./icon-sources/iconify.ts";
import { lobeIconsAdapter } from "./icon-sources/lobe-icons.ts";
import type { IconSourceAdapter } from "./icon-sources/types.ts";

// 65.2 follow-up 2026-05-25: lobe-icons moved FIRST. Three reasons:
//   1. AI-focused coverage — claude, gemini, dalle, openai, claudecode etc.
//      have dedicated lobe icons that are richer than simple-icons monochrome.
//   2. Wordmark variant — lobe publishes `<slug>-text.svg` for every brand;
//      simple-icons + iconify don't. Templates need wordmarks for layouts
//      with horizontal space.
//   3. Multi-color SVGs — Gemini's blue/green/red/yellow + Claude's color
//      come through inline. simple-icons gives only a single hex + monochrome.
// simple-icons + iconify stay as fallbacks for brands lobe doesn't ship.
const RESOLUTION_CHAIN: IconSourceAdapter[] = [
  lobeIconsAdapter,
  simpleIconsAdapter,
  iconifyAdapter,
];

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export type ResolvedIcon =
  | {
      type: "svg";
      svg: string;
      source: string;
      sourceRef: string;
      brandColor?: string;
      /**
       * Additional distinct brand-colors (multi-color logos like Gemini).
       * Empty/absent for single-color brands. Up to 2 entries.
       */
      additionalBrandColors?: string[];
      /**
       * Wordmark variant SVG content when the source exposes one (lobe-icons
       * `<slug>-text.svg`). Service uploads to a second R2 key alongside the
       * main symbol; null when the source has no wordmark.
       */
      wordmarkSvg?: string;
    }
  | { type: "avatar"; initials: string; hue: number };

export async function resolveToolIcon(
  projectId: string,
  toolSlug: string,
  _theme: "dark" | "light" = "dark"
): Promise<ResolvedIcon> {
  // 1. DB cache check
  const cached = await db.query.projectBrandAssets.findFirst({
    where: and(
      eq(projectBrandAssets.projectId, projectId),
      eq(projectBrandAssets.assetType, "tool_icon"),
      eq(projectBrandAssets.assetKey, toolSlug)
    ),
  });

  if (cached) {
    const validSources = ["simple-icons", "iconify", "lobe-icons"] as const;
    if ((validSources as readonly string[]).includes(cached.source) && cached.inlineSvg) {
      const cachedBrandColor = cached.metadata?.brandColor;
      const cachedAdditional = cached.metadata?.additionalBrandColors;
      const cachedWordmark = cached.metadata?.wordmarkSvg;
      const base = {
        type: "svg" as const,
        svg: cached.inlineSvg,
        source: cached.source,
        sourceRef: cached.sourceRef ?? "",
      };
      return {
        ...base,
        ...(typeof cachedBrandColor === "string" ? { brandColor: cachedBrandColor } : {}),
        ...(Array.isArray(cachedAdditional) && cachedAdditional.every((c) => typeof c === "string")
          ? { additionalBrandColors: cachedAdditional as string[] }
          : {}),
        ...(typeof cachedWordmark === "string" ? { wordmarkSvg: cachedWordmark } : {}),
      };
    }
    // deterministic-avatar is NOT terminal — fall through so the resolution chain
    // can upgrade the entry when a new PREFIX_BRAND_MAP rule is added later.
    // stale/unknown source (e.g. old broken "lobe-icons" entry) → re-resolve below
  }

  // 2–4. Walk resolution chain: simple-icons → iconify → lobe-icons
  for (const adapter of RESOLUTION_CHAIN) {
    let resolved = null;
    try {
      resolved = await adapter.tryResolve(toolSlug);
    } catch {
      // adapter failure is non-fatal; try next source
    }
    if (!resolved) continue;

    const metadata: Record<string, unknown> = {};
    if (resolved.brandColor !== undefined) metadata.brandColor = resolved.brandColor;
    if (resolved.additionalBrandColors && resolved.additionalBrandColors.length > 0) {
      metadata.additionalBrandColors = resolved.additionalBrandColors;
    }
    if (resolved.wordmarkSvgContent) {
      metadata.wordmarkSvg = resolved.wordmarkSvgContent;
    }

    await db
      .insert(projectBrandAssets)
      .values({
        projectId,
        assetType: "tool_icon",
        assetKey: toolSlug,
        source: resolved.source,
        sourceRef: resolved.sourceRef,
        inlineSvg: resolved.svgContent,
        displayName: toolSlug,
        metadata,
      })
      .onConflictDoUpdate({
        target: [projectBrandAssets.projectId, projectBrandAssets.assetType, projectBrandAssets.assetKey],
        set: {
          source: resolved.source,
          sourceRef: resolved.sourceRef,
          inlineSvg: resolved.svgContent,
          metadata,
          updatedAt: new Date(),
        },
      });

    const base = {
      type: "svg" as const,
      svg: resolved.svgContent,
      source: resolved.source,
      sourceRef: resolved.sourceRef,
    };
    return {
      ...base,
      ...(resolved.brandColor !== undefined ? { brandColor: resolved.brandColor } : {}),
      ...(resolved.additionalBrandColors && resolved.additionalBrandColors.length > 0
        ? { additionalBrandColors: resolved.additionalBrandColors }
        : {}),
      ...(resolved.wordmarkSvgContent ? { wordmarkSvg: resolved.wordmarkSvgContent } : {}),
    };
  }

  // 5. Deterministic avatar — never emoji
  await db
    .insert(projectBrandAssets)
    .values({
      projectId,
      assetType: "tool_icon",
      assetKey: toolSlug,
      source: "deterministic-avatar",
      displayName: toolSlug,
      metadata: {},
    })
    .onConflictDoNothing();

  return { type: "avatar", initials: toolSlug.slice(0, 2).toUpperCase(), hue: hashToHue(toolSlug) };
}
