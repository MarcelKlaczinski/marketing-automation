import type { FamilyATool } from "../../../compositions/_shared/family-a/types.ts";
import type { HeadToHeadDeepDiveContext } from "../headToHeadDeepDive.ts";
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

export const HEAD_TO_HEAD_DEEP_DIVE_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "Cursor vs Copilot Deep Dive (DE, dark)",
    description: "Full 2-tool deep dive with extendedPros/extendedCons",
    input: {
      winner: "cursor",
      angle: "Code-Qualität + Workflow + Pricing",
      tools: [
        tool("cursor", "Cursor", 90, "AI-First IDE · VS-Code-Fork",
          ["Composer für Multi-File-Refactors", "Tab-Completion mit Codebase-Kontext"],
          ["Höhere Latenz als Copilot inline", "Eigene IDE — Migration kostet Zeit"],
          {
            iconInitials: "CR", iconHue: 200, primaryColor: "#3b82f6",
            extendedPros: ["Inline-Edits direkt im Editor-Cursor", "Diff-Preview vor Annahme", "Local-Codebase RAG ohne Cloud-Upload"],
            extendedCons: ["Pro-Tier teurer als Copilot", "Bisweilen aggressive Suggestions"],
          }),
        tool("github-copilot", "GitHub Copilot", 84, "Inline-Autocomplete · VS-Code-Plugin",
          ["Native VS-Code-Integration", "Copilot Chat für Q&A im Editor"],
          ["Begrenzter Multi-File-Kontext", "Composer-Style-Refactors fehlen"],
          {
            iconInitials: "GC", iconHue: 30, primaryColor: "#10b981",
            extendedPros: ["GitHub-Enterprise-Integration nativ", "Sicherheitsfilter für vertrauliche Daten", "Günstigster Pro-Tier im Vergleich"],
            extendedCons: ["Kein Composer-Modus für Refactors", "Codebase-Kontext begrenzt auf offene Tabs"],
          }),
      ],
    } satisfies HeadToHeadDeepDiveContext,
  },

  "edge-min": {
    name: "ChatGPT vs Claude Deep Dive (EN, light)",
    description: "Minimal data — no extendedPros, fallback rendering",
    input: {
      tools: [
        tool("chatgpt", "ChatGPT", 88, "Conversational AI · OpenAI",
          ["Largest plugin ecosystem", "Code interpreter built-in"],
          ["Hallucinates citations", "Smaller context window"],
          { iconInitials: "CG", iconHue: 120 }),
        tool("claude", "Claude", 86, "Long context · Anthropic",
          ["200k context window", "Strong reasoning"],
          ["No image generation", "Fewer integrations"],
          { iconInitials: "CL", iconHue: 30 }),
      ],
    } satisfies HeadToHeadDeepDiveContext,
  },

  "edge-max": {
    name: "Midjourney vs Flux Deep Dive (DE, dark, max text)",
    description: "Max-length content with full extendedPros/extendedCons",
    input: {
      winner: "midjourney",
      angle: "Foto-Realismus + Aesthetic + Pricing",
      tools: [
        tool("midjourney", "Midjourney v7", 92, "Premium-Ästhetik · web + Discord",
          ["Beste Hero-Visuals out-of-the-box auf Agentur-Niveau", "--sref & --cref für Marken-Konsistenz über Sessions"],
          ["Schwer aus dem MJ-Look auszubrechen ohne Stil-Prompts", "Text-im-Bild bleibt schwach trotz v7-Update"],
          {
            iconInitials: "MJ", iconHue: 220, primaryColor: "#3b82f6",
            extendedPros: ["Style-Reference --sref für 90% Look-Konsistenz", "Character-Reference --cref für Markenfiguren", "Niji-Mode für Anime/Manga-Style verfügbar", "Web-UI mit Variations + Upscale One-Click"],
            extendedCons: ["Kein offizielles API — nur Discord-Bot oder Reverse-Engineering", "Pro-Tier $30/Monat teurer als Flux"],
          }),
        tool("flux", "Flux 1.1 Pro", 86, "Foto-Realismus · API + UI",
          ["Konsistentes Photo-Look-and-Feel für Produkt-Renderings", "Schnell + günstig per API für Volume-Workflows"],
          ["Style-Transfer noch schwach im Vergleich zu MJ", "Englisch-Prompts deutlich bevorzugt vs DE"],
          {
            iconInitials: "FL", iconHue: 30, primaryColor: "#f59e0b",
            extendedPros: ["Replicate + Fal.ai APIs für $0.04 / Image", "Schnellere Iteration (3s vs 60s MJ)", "Open-Source-Variante Flux Schnell verfügbar"],
            extendedCons: ["Aesthetic noch zu glatt für Agentur-Hero", "Keine Style-Library wie MJ"],
          }),
      ],
    } satisfies HeadToHeadDeepDiveContext,
  },
};
