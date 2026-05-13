import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Multi-candidate lookup: try these names in the iconify "logos" set
const TOOLWIKI_TO_ICONIFY: Record<string, string[]> = {
  // OpenAI family
  "openai": ["openai"],
  "chatgpt": ["openai"],
  "gpt-4": ["openai"],
  "gpt-4o": ["openai"],
  "gpt-4o-mini": ["openai"],
  "dall-e": ["openai"],
  "dall-e-3": ["openai"],
  "dall-e-4": ["openai"],
  "dalle": ["openai"],
  "sora": ["openai"],
  "openai-o1": ["openai"],
  "openai-o3": ["openai"],

  // Anthropic (iconify logos has both)
  "anthropic": ["anthropic"],

  // Image gen
  "midjourney": ["midjourney"],
  "flux": ["flux"],
  "flux-pro": ["flux"],
  "flux-dev": ["flux"],
  "flux-schnell": ["flux"],

  // Image enhancement / other AI
  "stability": ["stability-ai"],
  "stable-diffusion": ["stability-ai"],
  "stable-diffusion-xl": ["stability-ai"],
  "sdxl": ["stability-ai"],
  "stable-diffusion-3": ["stability-ai"],

  // Research
  "perplexity": ["perplexity"],

  // Design
  "figma": ["figma"],
  "notion": ["notion"],
};

export const iconifyAdapter: IconSourceAdapter = {
  name: "iconify",

  async tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null> {
    const { getIconData, iconToSVG } = await import("@iconify/utils");
    const logosData = await import("@iconify-json/logos/icons.json") as any;

    const candidates = TOOLWIKI_TO_ICONIFY[toolSlug] ?? [toolSlug];

    for (const candidate of candidates) {
      const iconData = getIconData(logosData, candidate);
      if (!iconData) continue;

      const rendered = iconToSVG(iconData);
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rendered.attributes.viewBox}">${rendered.body}</svg>`;
      return {
        source: "iconify",
        sourceRef: `logos:${candidate}`,
        svgContent,
        format: "svg",
      };
    }

    // Also try skill-icons as secondary set
    const skillData = await import("@iconify-json/skill-icons/icons.json") as any;
    for (const candidate of candidates) {
      const iconData = getIconData(skillData, candidate);
      if (!iconData) continue;

      const rendered = iconToSVG(iconData);
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rendered.attributes.viewBox}">${rendered.body}</svg>`;
      return {
        source: "iconify",
        sourceRef: `skill-icons:${candidate}`,
        svgContent,
        format: "svg",
      };
    }

    return null;
  },
};
