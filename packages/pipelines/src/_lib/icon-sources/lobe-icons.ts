import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Maps toolwiki slugs to @lobehub/icons-static-png icon slugs where they differ
const TOOL_SLUG_TO_LOBE: Record<string, string> = {
  // OpenAI products
  chatgpt: "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "dall-e": "openai",
  "dall-e-3": "openai",
  "dall-e-4": "openai",
  dalle: "openai",
  sora: "openai",
  "openai-o1": "openai",
  "openai-o3": "openai",

  // Anthropic / Claude
  "claude-ai": "claude",
  "claude-3": "claude",
  "claude-3-5": "claude",
  "claude-opus": "claude",
  "claude-sonnet": "claude",
  "claude-haiku": "claude",

  // Google
  "gemini-ai": "gemini",
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
const LOBE_ICONS_BASE = resolve(
  fileURLToPath(import.meta.url),
  "../../../../../../apps/api/node_modules/@lobehub/icons-static-png"
);

async function findLobeIconPath(slug: string, theme: "dark" | "light"): Promise<string | null> {
  for (const suffix of ["-color", ""] as const) {
    const p = resolve(LOBE_ICONS_BASE, theme, `${slug}${suffix}.png`);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

export const lobeIconsAdapter: IconSourceAdapter = {
  name: "lobe-icons",

  async tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null> {
    const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;
    // Try dark theme first (preferred for carousel dark mode)
    const filePath = await findLobeIconPath(lobeSlug, "dark") ?? await findLobeIconPath(lobeSlug, "light");
    if (!filePath) return null;

    const pngBuffer = await Bun.file(filePath).arrayBuffer();
    const base64 = Buffer.from(pngBuffer).toString("base64");

    return {
      source: "lobe-icons",
      sourceRef: lobeSlug,
      // Embed PNG as SVG image element so the output format stays consistent
      svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image href="data:image/png;base64,${base64}" width="256" height="256"/></svg>`,
      format: "svg",
    };
  },
};
