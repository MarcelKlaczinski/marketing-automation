import type { IconSourceAdapter, ResolvedIconAsset } from "./types.ts";

// Maps toolwiki slugs to simple-icons export keys (camelCase after "si")
// simple-icons v16 exports as siMidjourney, siOpenai, etc.
const TOOLWIKI_TO_SIMPLE_ICONS: Record<string, string> = {
  // Anthropic / Claude
  "claude": "claude",
  "claude-ai": "claude",
  "claude-3": "claude",
  "claude-opus": "claude",
  "claude-sonnet": "claude",
  "claude-haiku": "claude",
  "claude-code": "claude",      // Claude Code CLI — Anthropic product, uses same icon
  "claude-code-cli": "claude",
  "anthropic": "anthropic",

  // Google
  "gemini": "googlegemini",
  "gemini-ai": "googlegemini",
  "google-gemini": "googlegemini",
  "bard": "googlegemini",

  // OpenAI
  "chatgpt": "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "codex": "openai",
  "codex-cli": "openai",

  // Code assistants
  "cursor": "cursor",
  "codeium": "codeium",
  "tabnine": "tabnine",
  "copilot-inline": "githubcopilot",
  "copilot-chat": "githubcopilot",

  // Design
  "figma": "figma",
  "notion": "notion",

  // Dev tools
  "github-copilot": "githubcopilot",
  "copilot": "githubcopilot",
  "jetbrains": "jetbrains",
  "vscode": "visualstudiocode",
  "visual-studio-code": "visualstudiocode",

  // Audio/Voice
  "elevenlabs": "elevenlabs",

  // Search/Research
  "perplexity": "perplexity",
};

export const simpleIconsAdapter: IconSourceAdapter = {
  name: "simple-icons",

  async tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null> {
    const mapped = TOOLWIKI_TO_SIMPLE_ICONS[toolSlug] ?? toolSlug;
    // Build the export key: "si" + PascalCase, dashes stripped
    const exportKey = `si${mapped.charAt(0).toUpperCase()}${mapped.slice(1).replace(/-/g, "")}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siModule = await import("simple-icons") as any;
    const icon = siModule[exportKey];
    if (!icon?.svg) return null;

    // simple-icons SVGs lack the outer <svg> wrapper; wrap it
    const svgContent = icon.svg.startsWith("<svg")
      ? icon.svg
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${icon.svg}</svg>`;

    return {
      source: "simple-icons",
      sourceRef: mapped,
      svgContent,
      brandColor: `#${icon.hex}`,
      format: "svg",
    };
  },
};
