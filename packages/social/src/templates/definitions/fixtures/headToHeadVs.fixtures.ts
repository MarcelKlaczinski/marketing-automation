import type { FamilyATool } from "../../../compositions/_shared/family-a/types.ts";
import type { HeadToHeadVsContext } from "../headToHeadVs.ts";
import type { MockFixtureMap } from "../../types.ts";

function tool(
  slug: string,
  name: string,
  score: number,
  meta: string,
  pros: [string, string],
  cons: [string, string],
  extras: Partial<FamilyATool> = {},
): FamilyATool {
  return {
    slug,
    name,
    score,
    scoreTier: score >= 80 ? "hi" : score >= 65 ? "mid" : "lo",
    meta,
    pricePrefix: "",
    priceAmount: "",
    pros,
    cons,
    isWinner: false,
    ...extras,
  };
}

export const HEAD_TO_HEAD_VS_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "Cursor vs GitHub Copilot (DE, dark)",
    description: "2-tool head-to-head: AI code editors with clear differentiation",
    input: {
      winner: "cursor",
      angle: "Code-Qualität + Workflow",
      tools: [
        tool("cursor", "Cursor", 90, "AI-First IDE · VS-Code-Fork",
          ["Composer für Multi-File-Refactors", "Tab-Completion mit Codebase-Kontext"],
          ["Höhere Latenz als Copilot inline", "Eigene IDE — Migration kostet Zeit"],
          { iconInitials: "CR", iconHue: 200, primaryColor: "#3b82f6" }),
        tool("github-copilot", "GitHub Copilot", 84, "Inline-Autocomplete · VS-Code-Plugin",
          ["Native VS-Code-Integration", "Copilot Chat für Q&A im Editor"],
          ["Begrenzter Multi-File-Kontext", "Composer-Style-Refactors fehlen"],
          { iconInitials: "GC", iconHue: 30, primaryColor: "#10b981" }),
      ],
    } satisfies HeadToHeadVsContext,
  },

  "edge-min": {
    name: "ChatGPT vs Claude (EN, light)",
    description: "Minimal data — short pros/cons + no winner override",
    input: {
      tools: [
        tool("chatgpt", "ChatGPT", 88, "Conversational AI · OpenAI",
          ["Largest plugin ecosystem", "Code interpreter built-in"],
          ["Hallucinates on citations", "Context window smaller"],
          { iconInitials: "CG", iconHue: 120 }),
        tool("claude", "Claude", 86, "Long context · Anthropic",
          ["200k context window", "Strong reasoning"],
          ["No image generation", "Fewer 3rd-party integrations"],
          { iconInitials: "CL", iconHue: 30 }),
      ],
    } satisfies HeadToHeadVsContext,
  },

  "edge-max": {
    name: "Midjourney vs Flux (DE, dark, max text)",
    description: "Both tools at high score, max-length verdicts",
    input: {
      winner: "midjourney",
      angle: "Foto-Realismus + Aesthetic",
      tools: [
        tool("midjourney", "Midjourney v7", 92, "Premium-Ästhetik · web + Discord",
          ["Beste Hero-Visuals out-of-the-box auf Agentur-Niveau", "--sref & --cref für Marken-Konsistenz über Sessions"],
          ["Schwer aus dem MJ-Look auszubrechen ohne Stil-Prompts", "Text-im-Bild bleibt schwach trotz v7-Update"],
          { iconInitials: "MJ", iconHue: 220, primaryColor: "#3b82f6" }),
        tool("flux", "Flux 1.1 Pro", 86, "Foto-Realismus · API + UI",
          ["Konsistentes Photo-Look-and-Feel für Produkt-Renderings", "Schnell + günstig per API für Volume-Workflows"],
          ["Style-Transfer noch schwach im Vergleich zu MJ", "Englisch-Prompts deutlich bevorzugt vs DE"],
          { iconInitials: "FL", iconHue: 30, primaryColor: "#f59e0b" }),
      ],
    } satisfies HeadToHeadVsContext,
  },
};
