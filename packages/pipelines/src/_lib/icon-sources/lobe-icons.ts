import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Maps toolwiki slugs to @lobehub/icons static-svg / static-png icon slugs
// where they differ.
const TOOL_SLUG_TO_LOBE: Record<string, string> = {
  // OpenAI family — lobe-icons has dedicated icons for `openai`, `dalle`,
  // `sora` (model brands) but no `chatgpt*` (consumer-facing product). Map
  // chatgpt/gpt-* to the parent OpenAI brand; map dall-e/dalle to the
  // dedicated DALL-E icon (which has both `-color` and `-text` variants).
  chatgpt: "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "dall-e": "dalle",
  "dall-e-3": "dalle",
  "dall-e-4": "dalle",
  dalle: "dalle",
  // Sora is its own lobe brand with -color + -text variants — keep separate.
  sora: "sora",
  "openai-sora": "sora",
  "openai-o1": "openai",
  "openai-o3": "openai",
  // chatgpt-atlas / chatgpt-search / openai-operator aren't recognised lobe
  // brands — point at the OpenAI parent so they inherit the chatgpt-family
  // logo instead of falling through to the deterministic avatar.
  "chatgpt-atlas": "openai",
  "chatgpt-search": "openai",
  "openai-operator": "openai",

  // Anthropic / Claude family — lobe-icons has a SEPARATE `claudecode-color`
  // icon, distinct from `claude-color`. Map the cli/code slugs to it; the
  // generic claude-* model-tier slugs stay on the parent brand icon.
  "claude-ai": "claude",
  "claude-3": "claude",
  "claude-3-5": "claude",
  "claude-opus": "claude",
  "claude-sonnet": "claude",
  "claude-haiku": "claude",
  "claude-code": "claudecode",
  "claude-code-cli": "claudecode",
  // Newer Claude products without dedicated lobe icons — point at the parent
  // Claude brand so the salmon `#D97757` color + wordmark land instead of
  // monochrome simple-icons fallback.
  "claude-computer-use": "claude",
  "claude-skills": "claude",
  "claude-projects": "claude",

  // Google
  "gemini-ai": "gemini",
  // Gemini product variants — share the parent Gemini multi-color logo.
  "gemini-live": "gemini",
  "gemini-pro": "gemini",
  "gemini-flash": "gemini",
  "gemini-advanced": "gemini",
  "gemini-deep-research": "gemini",
  bard: "gemini",
  "google-bard": "gemini",

  // GitHub Copilot
  "github-copilot": "githubcopilot",
  copilot: "githubcopilot",

  // Stable Diffusion family
  "stable-diffusion": "stablediffusion",
  "stable-diffusion-xl": "stablediffusion",
  sdxl: "stablediffusion",
  "stable-diffusion-3": "stablediffusion",

  // Leonardo AI
  leonardo: "leonardoai",
  "leonardo-ai": "leonardoai",

  // Adobe Firefly
  "adobe-firefly": "adobefirefly",
  firefly: "adobefirefly",
};

// Resolved relative to THIS file: packages/pipelines/src/_lib/icon-sources/lobe-icons.ts
// ../../../../../../ = icon-sources → _lib → src → pipelines → packages → root
const LOBE_PNG_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../apps/api/node_modules/@lobehub/icons-static-png",
);
const LOBE_SVG_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../apps/api/node_modules/@lobehub/icons-static-svg",
);

/**
 * Prefer the `-color` variant where lobe-icons publishes one (223 of 850
 * brands as of 2026-05-25). Fall back to the monochrome `<slug>.svg`
 * otherwise. Returns the absolute filesystem path or null if neither exists.
 */
async function findLobeSvgPath(slug: string): Promise<string | null> {
  for (const suffix of ["-color", ""] as const) {
    const p = resolve(LOBE_SVG_BASE, "icons", `${slug}${suffix}.svg`);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

/**
 * PNG fallback path — only used when static-svg has no entry for the slug
 * (rare since static-svg covers the same brands as static-png).
 */
async function findLobePngPath(slug: string, theme: "dark" | "light"): Promise<string | null> {
  for (const suffix of ["-color", ""] as const) {
    const p = resolve(LOBE_PNG_BASE, theme, `${slug}${suffix}.png`);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

/**
 * lobe-icons `-color` SVGs come in three flavours:
 * 1. **Solid fill** — single-path docs with `fill="#D97757"` (Claude) → return
 *    the hex directly.
 * 2. **Gradient fill** — `fill="url(#...)"` referencing a `<linearGradient>` or
 *    `<radialGradient>` in `<defs>` (Kling, Luma, Hailuo) → use first
 *    stop-color as primary.
 * 3. **Multi-color** — multiple paths each with their own solid `fill="#..."`
 *    (Gemini = blue + green + red + yellow). Returns all distinct colors so
 *    the caller can seed secondary + tertiary slots, not just primary.
 *
 * Returns `{primary, additional}`: the first distinct hex as primary plus up
 * to 2 additional distinct hexes. Caller decides how to map onto the
 * primary/secondary/tertiary slots.
 */
function extractBrandColors(
  svgContent: string,
): { primary: string; additional: string[] } | null {
  // Collect all distinct solid-fill hexes in order of first appearance.
  const solid: string[] = [];
  const seen = new Set<string>();
  for (const match of svgContent.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)) {
    const hex = match[1]!.toUpperCase();
    // Skip structural near-white / near-black fills that are usually outline
    // or background helpers rather than brand-relevant. Heuristic: keep
    // anything outside `#EEEEEE..#FFFFFF` and `#000000..#111111`.
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const isNearWhite = r >= 0xee && g >= 0xee && b >= 0xee;
    const isNearBlack = r <= 0x11 && g <= 0x11 && b <= 0x11;
    if (isNearWhite || isNearBlack) continue;
    if (seen.has(hex)) continue;
    seen.add(hex);
    solid.push(hex);
  }
  if (solid.length > 0) {
    return { primary: solid[0]!, additional: solid.slice(1, 3) };
  }

  // Fallback — gradient reference. Find first url(#<id>) on a path's fill,
  // then collect distinct stop-colors from the matching gradient definition.
  const gradientRef = svgContent.match(/fill="url\(#([^)]+)\)"/);
  if (!gradientRef) return null;
  const gradientId = gradientRef[1]!;
  const gradientBlock = svgContent.match(
    new RegExp(
      `<(?:linearGradient|radialGradient)[^>]*\\bid="${gradientId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</(?:linearGradient|radialGradient)>`,
    ),
  );
  if (!gradientBlock) return null;
  const stops: string[] = [];
  const stopSeen = new Set<string>();
  for (const m of gradientBlock[1]!.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)) {
    const hex = m[1]!.toUpperCase();
    if (stopSeen.has(hex)) continue;
    stopSeen.add(hex);
    stops.push(hex);
  }
  if (stops.length === 0) return null;
  return { primary: stops[0]!, additional: stops.slice(1, 3) };
}

export const lobeIconsAdapter: IconSourceAdapter = {
  name: "lobe-icons",

  async tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null> {
    const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;

    // Prefer static-svg (vector + brand-color extractable).
    const svgPath = await findLobeSvgPath(lobeSlug);
    if (svgPath) {
      const svgContent = await Bun.file(svgPath).text();
      const colors = extractBrandColors(svgContent);
      // Try wordmark variant alongside — lobe publishes `<slug>-text.svg` for
      // every brand we have. Templates pick icon vs wordmark per layout.
      const wordmarkPath = resolve(LOBE_SVG_BASE, "icons", `${lobeSlug}-text.svg`);
      const wordmarkSvgContent = (await Bun.file(wordmarkPath).exists())
        ? await Bun.file(wordmarkPath).text()
        : undefined;
      return {
        source: "lobe-icons",
        sourceRef: lobeSlug,
        svgContent,
        format: "svg",
        ...(colors ? { brandColor: colors.primary } : {}),
        ...(colors && colors.additional.length > 0
          ? { additionalBrandColors: colors.additional }
          : {}),
        ...(wordmarkSvgContent ? { wordmarkSvgContent } : {}),
      };
    }

    // Fallback: static-png embedded inside an outer <svg><image/></svg>.
    // Kept for back-compat with any lobe brand that only ships PNGs.
    const pngPath =
      (await findLobePngPath(lobeSlug, "dark")) ??
      (await findLobePngPath(lobeSlug, "light"));
    if (!pngPath) return null;

    const pngBuffer = await Bun.file(pngPath).arrayBuffer();
    const base64 = Buffer.from(pngBuffer).toString("base64");
    return {
      source: "lobe-icons",
      sourceRef: lobeSlug,
      svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image href="data:image/png;base64,${base64}" width="256" height="256"/></svg>`,
      format: "svg",
    };
  },
};
