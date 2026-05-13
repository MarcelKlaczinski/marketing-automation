import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets } from "@marketing-auto/db";
import { simpleIconsAdapter } from "./icon-sources/simple-icons.ts";
import { iconifyAdapter } from "./icon-sources/iconify.ts";
import { lobeIconsAdapter } from "./icon-sources/lobe-icons.ts";
import type { IconSourceAdapter } from "./icon-sources/types.ts";

const RESOLUTION_CHAIN: IconSourceAdapter[] = [
  simpleIconsAdapter,
  iconifyAdapter,
  lobeIconsAdapter,
];

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export type ResolvedIcon =
  | { type: "svg"; svg: string; source: string; sourceRef: string; brandColor?: string }
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
      const base = {
        type: "svg" as const,
        svg: cached.inlineSvg,
        source: cached.source,
        sourceRef: cached.sourceRef ?? "",
      };
      return typeof cachedBrandColor === "string" ? { ...base, brandColor: cachedBrandColor } : base;
    }
    if (cached.source === "deterministic-avatar") {
      return { type: "avatar", initials: toolSlug.slice(0, 2).toUpperCase(), hue: hashToHue(toolSlug) };
    }
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
    return resolved.brandColor !== undefined ? { ...base, brandColor: resolved.brandColor } : base;
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
