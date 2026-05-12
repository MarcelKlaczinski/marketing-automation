/**
 * Icon resolution for social-image pipeline steps.
 * Queries project_brand_assets and resolves lobe-icons paths.
 * Self-contained — no dependency on apps/api brand-asset-service.
 */

import { and, eq } from "drizzle-orm";
import { db, projectBrandAssets } from "@marketing-auto/db";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mapping of tool slugs that don't match lobe-icons naming
const TOOL_SLUG_TO_LOBE: Record<string, string> = {
  chatgpt: "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "claude-ai": "claude",
  "gemini-ai": "gemini",
  "dall-e": "openai",
  "stable-diffusion": "stablediffusion",
};

// lobe-icons base is resolved relative to the running process's node_modules.
// The worker process is apps/api, so node_modules is at apps/api/node_modules.
// We use a relative path from this file's location at runtime:
// packages/pipelines/src/_lib → ../../../../apps/api/node_modules
const LOBE_ICONS_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../../apps/api/node_modules/@lobehub/icons-static-png"
);

function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

async function findLobeIcon(slug: string, theme: "dark" | "light"): Promise<string | null> {
  for (const suffix of ["-color", ""] as const) {
    const p = resolve(LOBE_ICONS_BASE, theme, `${slug}${suffix}.png`);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

export type ResolvedIcon =
  | { type: "path"; filePath: string }
  | { type: "url"; url: string }
  | { type: "svg"; svg: string }
  | { type: "avatar"; initials: string; hue: number };

export async function resolveToolIcon(
  projectId: string,
  toolSlug: string,
  theme: "dark" | "light" = "dark"
): Promise<ResolvedIcon> {
  // 1. DB lookup
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
      if (filePath) return { type: "path", filePath };
    }
    if (asset.source === "r2" && asset.sourceRef) {
      return { type: "url", url: `https://pub.toolwiki.ai/${asset.sourceRef}` };
    }
    if (asset.source === "inline-svg" && asset.inlineSvg) {
      return { type: "svg", svg: asset.inlineSvg };
    }
  }

  // 2. Try lobe-icons directly
  const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;
  const filePath = await findLobeIcon(lobeSlug, theme);
  if (filePath) return { type: "path", filePath };

  // 3. Deterministic avatar fallback
  return {
    type: "avatar",
    initials: toolSlug.slice(0, 2).toUpperCase(),
    hue: hashToHue(toolSlug),
  };
}
