import type { FamilyATool } from "../../../compositions/_shared/family-a/types.ts";
import type { Grid5Context } from "../comparisonGrid5.ts";
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

export const COMPARISON_GRID_5_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "AI image generators 5-way (DE, dark)",
    description: "5-tool AI image generator carousel, winner present, typical content length",
    input: {
      category: "KI-Bild-Generatoren",
      winner: "midjourney",
      tools: [
        tool("midjourney", "Midjourney v7", 92, "Premium-Ästhetik · web + Discord",
          ["Hero-Visuals out-of-the-box auf Agentur-Niveau", "--sref & --cref für Marken-Konsistenz"],
          ["Schwer aus dem MJ-Look auszubrechen", "Text im Bild bleibt schwach"],
          { isWinner: true, winnerFlagText: "Top Aesthetic", iconInitials: "MJ", iconHue: 220, primaryColor: "#3b82f6" }),
        tool("dalle", "DALL·E 4", 84, "Prompt-Adhärenz · via ChatGPT",
          ["Liefert exakt was du beschreibst", "Text endlich lesbar"],
          ["Stil oft glatt, austauschbar", "Weniger Stil-Kontrolle"],
          { iconInitials: "DE", iconHue: 160, primaryColor: "#10b981" }),
        tool("flux", "Flux 1.1 Pro", 81, "Foto-Realismus · API + UI",
          ["Konsistentes Photo-Look-and-Feel", "Schnell + günstig per API"],
          ["Style-Transfer noch schwach", "Englisch-Prompts bevorzugt"],
          { iconInitials: "FL", iconHue: 30, primaryColor: "#f59e0b" }),
        tool("ideogram", "Ideogram 2.0", 78, "Typografie · Web",
          ["Beste Text-im-Bild-Qualität im Vergleich", "Schnelle Iteration"],
          ["Foto-Look weniger natürlich", "Begrenzte Style-Library"],
          { iconInitials: "ID", iconHue: 290, primaryColor: "#c026d3" }),
        tool("stable-diffusion", "Stable Diffusion", 74, "Maximale Kontrolle · ComfyUI",
          ["LoRAs für 98% Charakter-Konsistenz", "Kein Abo, keine Quota, lokal"],
          ["Steile Lernkurve (Hardware + Nodes)", "SD-Default wirkt blass ohne LoRA"],
          { iconInitials: "SD", iconHue: 270, primaryColor: "#7c3aed" }),
      ],
    } satisfies Grid5Context,
  },

  "edge-min": {
    name: "AI writing assistants 5-way (EN, light, no winner)",
    description: "EN locale, light theme, minimal text, no winner card",
    input: {
      category: "AI writing assistants",
      tools: [
        tool("chatgpt", "GPT-4o", 91, "Best all-rounder · ChatGPT",
          ["Best at creative tasks", "Widest plugin ecosystem"],
          ["No free tier for GPT-4o", "Context window limited"], { iconInitials: "GP", iconHue: 120 }),
        tool("claude", "Claude", 89, "Long context · Anthropic",
          ["200k context window", "Strong at analysis"],
          ["No image generation", "Fewer integrations"], { iconInitials: "CL", iconHue: 200 }),
        tool("gemini", "Gemini", 75, "Google Search · native",
          ["Free with Google account", "Live web access"],
          ["Inconsistent quality", "Limited creative range"], { iconInitials: "GM", iconHue: 45 }),
        tool("perplexity", "Perplexity", 73, "Search + cite · web",
          ["Cited sources for every answer", "Strong research mode"],
          ["No code interpreter", "Limited file uploads"], { iconInitials: "PX", iconHue: 200 }),
        tool("mistral", "Mistral Large", 68, "Open weights · EU",
          ["EU data residency", "Open weights available"],
          ["Smaller plugin ecosystem", "Less polished UX"], { iconInitials: "MS", iconHue: 280 }),
      ],
    } satisfies Grid5Context,
  },

  "edge-max": {
    name: "Video AI platforms 5-way (DE, dark, max text)",
    description: "Maximum-length content, long bullet texts, score tier lo present",
    input: {
      category: "Video-KI-Plattformen",
      winner: "runway",
      tools: [
        tool("runway", "Runway Gen-4", 88, "Cinematic Quality · Professionals",
          ["Beste Motion-Konsistenz bei langen Szenen", "Director Mode für präzise Kamera-Kontrolle"],
          ["Teuerste Option im Vergleich bei hohem Vol.", "Render-Zeiten bei 4K über 5 Minuten/Clip"],
          { isWinner: true, winnerFlagText: "Profi-Empfehlung", iconInitials: "RW", iconHue: 300, primaryColor: "#a855f7" }),
        tool("kling", "Kling AI 2.0", 82, "Photorealism · API-first Platform",
          ["Fotorealistischste Gesichter im Vergleich", "Pay-per-Clip — ideal für kleines Volumen"],
          ["Kein konsistenter Charakter über Clips", "API-Dokumentation noch lückenhaft"],
          { iconInitials: "KL", iconHue: 180 }),
        tool("veo", "Google Veo 3", 79, "Audio + Video · Vertex AI",
          ["Synchroner Audio-Track automatisch generiert", "Vertex-Integration für Enterprise"],
          ["Nur in Vertex AI verfügbar (kein Web-UI)", "Kein Style-Transfer aus Referenzen"],
          { iconInitials: "VE", iconHue: 200 }),
        tool("sora", "Sora 2", 76, "OpenAI · ChatGPT-bundled",
          ["Lange Szenen ohne Render-Splits möglich", "Im ChatGPT-Plus-Plan enthalten"],
          ["Lange Warteschlange zu Spitzenzeiten", "Keine offene API für Devs"],
          { iconInitials: "SO", iconHue: 60 }),
        tool("hailuo", "Hailuo MiniMax", 61, "Speed & Cost · High Volume",
          ["Schnellste Generierung im Test (unter 60s)", "Kostenlose Beta ohne Warteliste"],
          ["Qualität für professionelle Nutzung schwach", "Datenschutz-Bestimmungen unklar (China)"],
          { iconInitials: "HL", iconHue: 60 }),
      ],
    } satisfies Grid5Context,
  },
};
