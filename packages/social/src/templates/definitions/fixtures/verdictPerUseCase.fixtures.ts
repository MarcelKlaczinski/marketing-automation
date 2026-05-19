import type { MockFixtureMap } from "../../types.ts";
import type { VerdictContext } from "../verdictPerUseCase.ts";

export const USE_CASE_VERDICT_FIXTURES: MockFixtureMap = {
  // ─── characteristic — 7 use cases, DE, matches spec HTML example closely ───
  characteristic: {
    name: "KI-Bild-Generatoren (DE) — 7 Use-Cases",
    description: "7 use cases dark DE, multi-tool AI image comparison — reference article",
    input: {
      useCases: [
        { label: "Marketing-Visuals", winnerSlug: "midjourney", winnerName: "Midjourney v7", iconInitials: "MJ", iconHue: 260 },
        { label: "Photoshop-Workflow", winnerSlug: "adobe-firefly", winnerName: "Adobe Firefly 3", iconInitials: "FF", iconHue: 20 },
        { label: "Produktfotos & E-Commerce", winnerSlug: "flux", winnerName: "Flux 1.2 Pro", iconInitials: "FL", iconHue: 200 },
        { label: "Typografie & Logos", winnerSlug: "ideogram", winnerName: "Ideogram v3", iconInitials: "ID", iconHue: 300 },
        { label: "Konsistente Charaktere", winnerSlug: "stable-diffusion", winnerName: "SD + LoRA", iconInitials: "SD", iconHue: 160 },
        { label: "Game-Assets & Concept Art", winnerSlug: "leonardo-ai", winnerName: "Leonardo AI", iconInitials: "LE", iconHue: 40 },
        { label: "Real-Time im Workshop", winnerSlug: "krea", winnerName: "Krea", iconInitials: "KR", iconHue: 320 },
      ],
      toolNames: ["Midjourney", "Adobe Firefly", "Flux", "Ideogram", "Stable Diffusion", "Leonardo AI", "Krea"],
    } satisfies VerdictContext,
  },

  // ─── edge-min — 5 use cases (minimum), EN light, short labels + tool names ─
  "edge-min": {
    name: "AI Writing Tools (EN) — 5 use cases (minimum)",
    description: "5 use cases (minimum), EN light, proves no layout gap when fewer rows",
    input: {
      useCases: [
        { label: "Long documents", winnerSlug: "claude", winnerName: "Claude", iconInitials: "CL", iconHue: 200 },
        { label: "Creative writing", winnerSlug: "chatgpt", winnerName: "GPT-4o", iconInitials: "GP", iconHue: 160 },
        { label: "Code generation", winnerSlug: "cursor", winnerName: "Cursor", iconInitials: "CU", iconHue: 280 },
        { label: "Web search", winnerSlug: "perplexity", winnerName: "Perplexity", iconInitials: "PX", iconHue: 40 },
        { label: "Free tier", winnerSlug: "gemini", winnerName: "Gemini", iconInitials: "GE", iconHue: 100 },
      ],
      toolNames: ["Claude", "ChatGPT", "Cursor", "Perplexity", "Gemini"],
    } satisfies VerdictContext,
  },

  // ─── edge-max — 7 use cases (maximum), DE dark, labels + names at bounds ───
  "edge-max": {
    name: "KI-Schreibtools (DE) — 7 Use-Cases at bound limits",
    description: "7 use cases maximum dark DE, labels ~30 chars and winner names ~16 chars — proves no overflow",
    input: {
      useCases: [
        { label: "Lange Dokumente & Analysen", winnerSlug: "claude", winnerName: "Claude Sonnet", iconInitials: "CL", iconHue: 200 },
        { label: "Kreatives Schreiben & Storys", winnerSlug: "chatgpt", winnerName: "GPT-4o", iconInitials: "GP", iconHue: 160 },
        { label: "Code & technische Doku", winnerSlug: "github-copilot", winnerName: "GitHub Copilot", iconInitials: "GH", iconHue: 280 },
        { label: "Aktuelle News & Web-Recherche", winnerSlug: "perplexity", winnerName: "Perplexity Pro", iconInitials: "PX", iconHue: 40 },
        { label: "Präsentationen & Slides", winnerSlug: "gamma", winnerName: "Gamma", iconInitials: "GA", iconHue: 100 },
        { label: "E-Mails & Kundenkommunik.", winnerSlug: "claude-haiku", winnerName: "Claude Haiku", iconInitials: "CL", iconHue: 200 },
        { label: "Kostenlose Einsteiger-Option", winnerSlug: "gemini", winnerName: "Gemini 2.0 Flash", iconInitials: "GE", iconHue: 60 },
      ],
      toolNames: ["Claude", "ChatGPT", "GitHub Copilot", "Perplexity", "Gamma", "Claude Haiku", "Gemini"],
    } satisfies VerdictContext,
  },
};
