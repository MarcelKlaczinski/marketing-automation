import type { MockFixtureMap } from "../../types.ts";
import type { Grid3Context } from "../comparisonGrid3.ts";

export const COMPARISON_GRID_3_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "AI image generators 3-way (DE, dark)",
    description: "3-tool AI image generator comparison, winner present, typical content length",
    input: {
      tools: [
        {
          slug: "midjourney",
          name: "Midjourney v7",
          score: 92,
          meta: "Premium-Ästhetik · web + Discord",
          pricingTier: "paid",
          priceFrom: 10,
          isWinner: true,
          winnerFlagText: "Top Aesthetic",
          pros: [
            "Hero-Visuals out-of-the-box auf Agentur-Niveau",
            "--sref & --cref für Marken-Konsistenz",
          ] as [string, string],
          cons: [
            "Schwer aus dem MJ-Look auszubrechen",
            "Text im Bild bleibt schwach",
          ] as [string, string],
          iconInitials: "MJ",
          iconHue: 220,
        },
        {
          slug: "dalle",
          name: "DALL·E 4",
          score: 81,
          meta: "Prompt-Adhärenz · via ChatGPT",
          pricingTier: "paid",
          priceFrom: 20,
          isWinner: false,
          pros: [
            "Liefert exakt was du beschreibst",
            "Text endlich lesbar",
          ] as [string, string],
          cons: [
            "Stil oft glatt, austauschbar",
            "Weniger Stil-Kontrolle",
          ] as [string, string],
          iconInitials: "DE",
          iconHue: 160,
        },
        {
          slug: "stable-diffusion",
          name: "Stable Diffusion",
          score: 74,
          meta: "Maximale Kontrolle · ComfyUI",
          pricingTier: "free",
          priceFrom: 0,
          isWinner: false,
          pros: [
            "LoRAs für 98% Charakter-Konsistenz",
            "Kein Abo, keine Quota, lokal",
          ] as [string, string],
          cons: [
            "Steile Lernkurve (Hardware + Nodes)",
            "SD-Default wirkt blass ohne LoRA",
          ] as [string, string],
          iconInitials: "SD",
          iconHue: 270,
        },
      ],
      winner: "midjourney",
    } satisfies Grid3Context,
  },

  "edge-min": {
    name: "AI writing assistants 3-way (EN, light, no winner)",
    description: "EN locale, light theme, minimal text, no winner card",
    input: {
      tools: [
        {
          slug: "chatgpt",
          name: "GPT-4o",
          score: 91,
          meta: "Best all-rounder · ChatGPT",
          pricingTier: "paid",
          priceFrom: 20,
          isWinner: false,
          pros: [
            "Best at creative tasks",
            "Widest plugin ecosystem",
          ] as [string, string],
          cons: [
            "No free tier for GPT-4o",
            "Context window limited",
          ] as [string, string],
          iconInitials: "GP",
          iconHue: 120,
        },
        {
          slug: "claude",
          name: "Claude",
          score: 89,
          meta: "Long context · Anthropic",
          pricingTier: "paid",
          priceFrom: 20,
          isWinner: false,
          pros: [
            "200k context window",
            "Strong at analysis",
          ] as [string, string],
          cons: [
            "No image generation",
            "Fewer integrations",
          ] as [string, string],
          iconInitials: "CL",
          iconHue: 200,
        },
        {
          slug: "gemini",
          name: "Gemini",
          score: 75,
          meta: "Google Search · native",
          pricingTier: "free",
          priceFrom: 0,
          isWinner: false,
          pros: [
            "Free with Google account",
            "Live web access",
          ] as [string, string],
          cons: [
            "Inconsistent quality",
            "Limited creative range",
          ] as [string, string],
          iconInitials: "GM",
          iconHue: 45,
        },
      ],
    } satisfies Grid3Context,
  },

  "edge-max": {
    name: "Video AI platforms 3-way (DE, dark, max text)",
    description: "Maximum-length content, long bullet texts, score tier lo present",
    input: {
      tools: [
        {
          slug: "runway",
          name: "Runway Gen-4",
          score: 88,
          meta: "Cinematic Quality · Professionals",
          pricingTier: "paid",
          priceFrom: 15,
          isWinner: true,
          winnerFlagText: "Profi-Empfehlung",
          pros: [
            "Beste Motion-Konsistenz bei langen Szenen",
            "Director Mode für präzise Kamera-Kontrolle",
          ] as [string, string],
          cons: [
            "Teuerste Option im Vergleich bei hohem Vol.",
            "Render-Zeiten bei 4K über 5 Minuten/Clip",
          ] as [string, string],
          iconInitials: "RW",
          iconHue: 300,
        },
        {
          slug: "kling",
          name: "Kling AI 2.0",
          score: 82,
          meta: "Photorealism · API-first Platform",
          pricingTier: "paid",
          priceFrom: 0,
          isWinner: false,
          pros: [
            "Fotorealistischste Gesichter im Vergleich",
            "Pay-per-Clip — ideal für kleines Volumen",
          ] as [string, string],
          cons: [
            "Kein konsistenter Charakter über Clips",
            "API-Dokumentation noch lückenhaft",
          ] as [string, string],
          iconInitials: "KL",
          iconHue: 180,
        },
        {
          slug: "hailuo",
          name: "Hailuo MiniMax",
          score: 61,
          meta: "Speed & Cost · High Volume",
          pricingTier: "free",
          priceFrom: 0,
          isWinner: false,
          pros: [
            "Schnellste Generierung im Test (unter 60s)",
            "Kostenlose Beta ohne Warteliste",
          ] as [string, string],
          cons: [
            "Qualität für professionelle Nutzung schwach",
            "Datenschutz-Bestimmungen unklar (China)",
          ] as [string, string],
          iconInitials: "HL",
          iconHue: 60,
        },
      ],
      winner: "runway",
    } satisfies Grid3Context,
  },
};
