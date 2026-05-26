import type { FamilyATool } from "../../../compositions/_shared/family-a/types.ts";
import type { Grid3Context } from "../comparisonGrid3.ts";
import type { MockFixtureMap } from "../../types.ts";

/**
 * Spec 65.7 — `comparison-grid-3` multi-slide carousel fixtures.
 *
 * Pre-filled FamilyATool shapes (pricePrefix/priceAmount left blank — render
 * fills them locale-aware at composition time). Each fixture covers the
 * canonical characteristic / edge-min / edge-max trio per Spec 59.3.5.
 */

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

export const COMPARISON_GRID_3_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "AI image generators 3-way (DE, dark)",
    description: "3-tool AI image generator carousel, winner present, typical content length",
    input: {
      category: "KI-Bild-Generatoren",
      winner: "midjourney",
      tools: [
        tool(
          "midjourney",
          "Midjourney v7",
          92,
          "Premium-Ästhetik · web + Discord",
          [
            "Hero-Visuals out-of-the-box auf Agentur-Niveau",
            "--sref & --cref für Marken-Konsistenz",
          ],
          [
            "Schwer aus dem MJ-Look auszubrechen",
            "Text im Bild bleibt schwach",
          ],
          {
            isWinner: true,
            winnerFlagText: "Top Aesthetic",
            iconInitials: "MJ",
            iconHue: 220,
            primaryColor: "#3b82f6",
            secondaryColor: "#60a5fa",
          },
        ),
        tool(
          "dalle",
          "DALL·E 4",
          81,
          "Prompt-Adhärenz · via ChatGPT",
          [
            "Liefert exakt was du beschreibst",
            "Text endlich lesbar",
          ],
          [
            "Stil oft glatt, austauschbar",
            "Weniger Stil-Kontrolle",
          ],
          { iconInitials: "DE", iconHue: 160, primaryColor: "#10b981" },
        ),
        tool(
          "stable-diffusion",
          "Stable Diffusion",
          74,
          "Maximale Kontrolle · ComfyUI",
          [
            "LoRAs für 98% Charakter-Konsistenz",
            "Kein Abo, keine Quota, lokal",
          ],
          [
            "Steile Lernkurve (Hardware + Nodes)",
            "SD-Default wirkt blass ohne LoRA",
          ],
          { iconInitials: "SD", iconHue: 270, primaryColor: "#7c3aed" },
        ),
      ],
    } satisfies Grid3Context,
  },

  "edge-min": {
    name: "AI writing assistants 3-way (EN, light, no winner)",
    description: "EN locale, light theme, minimal text, no winner card",
    input: {
      category: "AI writing assistants",
      tools: [
        tool(
          "chatgpt",
          "GPT-4o",
          91,
          "Best all-rounder · ChatGPT",
          ["Best at creative tasks", "Widest plugin ecosystem"],
          ["No free tier for GPT-4o", "Context window limited"],
          { iconInitials: "GP", iconHue: 120 },
        ),
        tool(
          "claude",
          "Claude",
          89,
          "Long context · Anthropic",
          ["200k context window", "Strong at analysis"],
          ["No image generation", "Fewer integrations"],
          { iconInitials: "CL", iconHue: 200 },
        ),
        tool(
          "gemini",
          "Gemini",
          75,
          "Google Search · native",
          ["Free with Google account", "Live web access"],
          ["Inconsistent quality", "Limited creative range"],
          { iconInitials: "GM", iconHue: 45 },
        ),
      ],
    } satisfies Grid3Context,
  },

  "edge-max": {
    name: "Video AI platforms 3-way (DE, dark, max text)",
    description: "Maximum-length content, long bullet texts, score tier lo present",
    input: {
      category: "Video-KI-Plattformen",
      winner: "runway",
      tools: [
        tool(
          "runway",
          "Runway Gen-4",
          88,
          "Cinematic Quality · Professionals",
          [
            "Beste Motion-Konsistenz bei langen Szenen",
            "Director Mode für präzise Kamera-Kontrolle",
          ],
          [
            "Teuerste Option im Vergleich bei hohem Vol.",
            "Render-Zeiten bei 4K über 5 Minuten/Clip",
          ],
          {
            isWinner: true,
            winnerFlagText: "Profi-Empfehlung",
            iconInitials: "RW",
            iconHue: 300,
            primaryColor: "#a855f7",
          },
        ),
        tool(
          "kling",
          "Kling AI 2.0",
          82,
          "Photorealism · API-first Platform",
          [
            "Fotorealistischste Gesichter im Vergleich",
            "Pay-per-Clip — ideal für kleines Volumen",
          ],
          [
            "Kein konsistenter Charakter über Clips",
            "API-Dokumentation noch lückenhaft",
          ],
          { iconInitials: "KL", iconHue: 180 },
        ),
        tool(
          "hailuo",
          "Hailuo MiniMax",
          61,
          "Speed & Cost · High Volume",
          [
            "Schnellste Generierung im Test (unter 60s)",
            "Kostenlose Beta ohne Warteliste",
          ],
          [
            "Qualität für professionelle Nutzung schwach",
            "Datenschutz-Bestimmungen unklar (China)",
          ],
          { iconInitials: "HL", iconHue: 60 },
        ),
      ],
    } satisfies Grid3Context,
  },
};
