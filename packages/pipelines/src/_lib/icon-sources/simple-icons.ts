import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Maps toolwiki slugs to simple-icons export keys (camelCase after "si")
// simple-icons v16 exports as siMidjourney, siOpenai, etc.
const TOOLWIKI_TO_SIMPLE_ICONS: Record<string, string> = {
  // Anthropic / Claude
  "claude": "claude",
  "claude-ai": "claude",
  "claude-3": "claude",
  "claude-3-5": "claude",
  "claude-opus": "claude",
  "claude-sonnet": "claude",
  "claude-haiku": "claude",
  "claude-code": "claude",
  "claude-code-cli": "claude",
  "anthropic": "anthropic",

  // Google
  "gemini": "googlegemini",
  "gemini-ai": "googlegemini",
  "gemini-pro": "googlegemini",
  "gemini-ultra": "googlegemini",
  "gemini-flash": "googlegemini",
  "google-gemini": "googlegemini",
  "google-ai": "google",
  "google-ai-studio": "google",
  "bard": "googlegemini",
  "google-notebooklm": "google",
  "notebooklm": "google",

  // OpenAI — all pricing/tier variants map to the OpenAI logo
  "openai": "openai",
  "openai-api": "openai",
  "chatgpt": "openai",
  "chatgpt-free": "openai",
  "chatgpt-plus": "openai",
  "chatgpt-pro": "openai",
  "chatgpt-team": "openai",
  "chatgpt-enterprise": "openai",
  "chatgpt-edu": "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "gpt-4-turbo": "openai",
  "gpt-4o-mini": "openai",
  "gpt-3": "openai",
  "gpt-3.5": "openai",
  "gpt-3.5-turbo": "openai",
  "gpt-o1": "openai",
  "o1": "openai",
  "o1-mini": "openai",
  "o3": "openai",
  "o3-mini": "openai",
  "o4": "openai",
  "o4-mini": "openai",
  "sora": "openai",
  // dall-e / dalle: prefer the dedicated DALL-E icon when simple-icons
  // exports one, fall through to openai parent brand otherwise. The
  // exact-match lookup tries the mapped value first; the adapter walks back
  // through PREFIX_BRAND_MAP if there's no `siDalle` export.
  "dall-e": "dalle",
  "dall-e-3": "dalle",
  "dalle": "dalle",
  "codex": "openai",
  "openai-operator": "openai",
  "openai-search": "openai",
  "codex-cli": "openai",
  "openai-codex": "openai",
  "whisper": "openai",

  // Microsoft / Copilot
  "copilot": "microsoftcopilot",
  "github-copilot": "githubcopilot",
  "github-copilot-chat": "githubcopilot",
  "copilot-inline": "githubcopilot",
  "copilot-chat": "githubcopilot",
  "microsoft-copilot": "microsoftcopilot",
  "bing-chat": "microsoftbing",
  "bing": "microsoftbing",

  // Code assistants
  "cursor": "cursor",
  "codeium": "codeium",
  "windsurf": "codeium",
  "tabnine": "tabnine",
  "jetbrains-ai": "jetbrains",
  "jetbrains": "jetbrains",
  "vscode": "visualstudiocode",
  "visual-studio-code": "visualstudiocode",
  "visual-studio": "visualstudio",
  "replit": "replit",
  "replit-ai": "replit",

  // Design / Creativity
  "figma": "figma",
  "figma-ai": "figma",
  "midjourney": "midjourney",
  "adobe-firefly": "adobe",
  "adobe": "adobe",
  "adobe-photoshop": "adobephotoshop",
  "adobe-illustrator": "adobeillustrator",
  "canva": "canva",
  "canva-ai": "canva",
  "stable-diffusion": "stability",
  "stability-ai": "stability",

  // Productivity / Writing
  "notion": "notion",
  "notion-ai": "notion",
  "grammarly": "grammarly",
  "jasper": "jasper",
  "jasper-ai": "jasper",
  "copy-ai": "copyai",
  "writesonic": "writesonic",

  // Search / Research
  "perplexity": "perplexity",
  "perplexity-ai": "perplexity",
  "you-com": "you",

  // Audio/Voice
  "elevenlabs": "elevenlabs",
  "murf": "murf",

  // Video
  "runway": "runway",
  "runway-ml": "runway",

  // Data / Analytics
  "hugging-face": "huggingface",
  "huggingface": "huggingface",
  "cohere": "cohere",
  "mistral": "mistral",
  "mistral-ai": "mistral",
  "llama": "meta",
  "llama-2": "meta",
  "llama-3": "meta",
  "meta-ai": "meta",
};

// Prefix-based fallback: if a slug starts with one of these prefixes, use the brand icon.
// Covers pricing tiers, model versions, and minor product variants not listed above.
const PREFIX_BRAND_MAP: Array<[prefix: string, icon: string]> = [
  ["chatgpt-", "openai"],
  ["gpt-", "openai"],
  ["claude-", "claude"],
  ["gemini-", "googlegemini"],
  ["copilot-", "githubcopilot"],
  ["github-copilot", "githubcopilot"],
  ["microsoft-copilot", "microsoftcopilot"],
  ["adobe-", "adobe"],
  ["figma-", "figma"],
  ["notion-", "notion"],
  ["canva-", "canva"],
  ["perplexity-", "perplexity"],
  ["midjourney-", "midjourney"],
  ["dall-e", "openai"],
  ["o1-", "openai"],
  ["o3-", "openai"],
  ["o4-", "openai"],
  ["llama-", "meta"],
  ["mistral-", "mistral"],
  ["runway-", "runway"],
  ["elevenlabs-", "elevenlabs"],
  ["replit-", "replit"],
  ["codeium-", "codeium"],
  ["cursor-", "cursor"],
  ["hugging-face", "huggingface"],
];

export const simpleIconsAdapter: IconSourceAdapter = {
  name: "simple-icons",

  async tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null> {
    // Exact match → prefix fallback → raw slug
    const prefixMatch = PREFIX_BRAND_MAP.find(([p]) => toolSlug.startsWith(p));
    const mapped = TOOLWIKI_TO_SIMPLE_ICONS[toolSlug] ?? prefixMatch?.[1] ?? toolSlug;
    // Build the export key: "si" + PascalCase, dashes stripped
    const exportKey = `si${mapped.charAt(0).toUpperCase()}${mapped.slice(1).replace(/-/g, "")}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siModule = await import("simple-icons") as any;
    const icon = siModule[exportKey];
    if (!icon?.svg) return null;

    // simple-icons SVGs lack the outer <svg> wrapper; wrap it
    const rawSvg = icon.svg.startsWith("<svg")
      ? icon.svg
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${icon.svg}</svg>`;

    // Colorize: simple-icons publishes monochrome SVGs without an explicit
    // fill on the root <svg> tag — paths inherit `currentColor` which renders
    // black on white-card backgrounds (Spec 65.2 follow-up screenshot
    // 2026-05-25: Claude logo barely visible). Inject the brand hex so the
    // SVG renders in-brand without consumer-side styling. Skip when an
    // explicit `fill=` attribute is already on the root element (lobe-icons
    // colored variants don't go through this adapter, but a defensive check
    // future-proofs the path).
    const hex = `#${icon.hex}`;
    const svgContent = /<svg[^>]*\sfill=/.test(rawSvg)
      ? rawSvg
      : rawSvg.replace(/<svg\b/, `<svg fill="${hex}"`);

    return {
      source: "simple-icons",
      sourceRef: mapped,
      svgContent,
      brandColor: hex,
      format: "svg",
    };
  },
};
