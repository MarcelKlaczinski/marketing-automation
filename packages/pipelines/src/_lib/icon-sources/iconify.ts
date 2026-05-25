import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Multi-candidate lookup: try these names in the iconify "logos" set
const TOOLWIKI_TO_ICONIFY: Record<string, string[]> = {
  // OpenAI family — all chatgpt-* sub-plan slugs map to the openai logo
  "openai": ["openai"],
  "chatgpt": ["openai"],
  "chatgpt-free": ["openai"],
  "chatgpt-go": ["openai"],
  "chatgpt-plus": ["openai"],
  "chatgpt-pro": ["openai"],
  "chatgpt-team": ["openai"],
  "chatgpt-business": ["openai"],
  "chatgpt-enterprise": ["openai"],
  "chatgpt-edu": ["openai"],
  "gpt-4": ["openai"],
  "gpt-4o": ["openai"],
  "gpt-4o-mini": ["openai"],
  // DALL-E: try dedicated icon first, parent OpenAI as fallback
  "dall-e": ["dalle", "openai"],
  "dall-e-3": ["dalle", "openai"],
  "dall-e-4": ["dalle", "openai"],
  "dalle": ["dalle", "openai"],
  "sora": ["openai"],
  "openai-o1": ["openai"],
  "openai-o3": ["openai"],
  "openai-operator": ["openai"],

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
    // biome-ignore lint/suspicious/noExplicitAny: iconify .json import is untyped at the package level
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
    // biome-ignore lint/suspicious/noExplicitAny: iconify .json import is untyped at the package level
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

    // 65.2 follow-up: devicon namespace (~150 dev-tool icons, MIT). Lifts
    // coverage on long-tail Astro / Node / framework brands that simple-icons
    // + lobe-icons + iconify/logos all miss. Try plain slug AND `-original`
    // variant (devicon naming convention for the colored canonical form, e.g.
    // `python-original`, `rust-original`).
    // biome-ignore lint/suspicious/noExplicitAny: iconify .json import is untyped at the package level
    const deviconData = await import("@iconify-json/devicon/icons.json") as any;
    for (const candidate of candidates) {
      for (const suffix of ["-original", ""]) {
        const key = `${candidate}${suffix}`;
        const iconData = getIconData(deviconData, key);
        if (!iconData) continue;
        const rendered = iconToSVG(iconData);
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rendered.attributes.viewBox}">${rendered.body}</svg>`;
        return {
          source: "iconify",
          sourceRef: `devicon:${key}`,
          svgContent,
          format: "svg",
        };
      }
    }

    return null;
  },
};
