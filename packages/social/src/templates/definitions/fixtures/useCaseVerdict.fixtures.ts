import type { MockFixtureMap } from "../../types.ts";
import type { ComparisonContext } from "../../adapters/comparison.ts";

export const USE_CASE_VERDICT_FIXTURES: MockFixtureMap = {
  "recraft-vs-ideogram-de": {
    name: "Recraft vs. Ideogram (DE) — 5 Use-Cases",
    description: "2-Tool AI image generator comparison, German, 5 useCaseVerdicts — reference article",
    input: {
      tools: [
        {
          slug: "recraft",
          name: "Recraft",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Bild-Generator",
          iconInitials: "RC",
          iconHue: 220,
        },
        {
          slug: "ideogram",
          name: "Ideogram",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Bild-Generator",
          iconInitials: "ID",
          iconHue: 280,
        },
      ],
      verdict: "Recraft gewinnt für Vektor-Design und Logo-Arbeit. Ideogram dominiert Text-im-Bild.",
      winner: "recraft",
      useCaseVerdicts: [
        {
          useCase: "Logo-Design für Brand-Identität",
          winner: "recraft",
          reason:
            "Vektor-Export und Brand-Konsistenz sind hier entscheidend — Recraft liefert beide aus der Box.",
        },
        {
          useCase: "Text im Bild (z.B. Poster, Meme)",
          winner: "ideogram",
          reason: "Ideograms Typografie-Kontrolle ist klar überlegen. Weniger Halluzinationen bei Buchstaben.",
        },
        {
          useCase: "Social-Media-Posts",
          winner: "recraft",
          reason: "Mehr vorgefertigte Formate, bessere Pixel-Kontrolle für Quadrat-Zuschnitte.",
        },
        {
          useCase: "Produktbilder (Freisteller)",
          winner: "recraft",
          reason: "Sauberere Hintgrundremovals, konsistentere Objektisolation bei komplexen Formen.",
        },
        {
          useCase: "Poster-Design & Kampagnen",
          winner: "ideogram",
          reason:
            "Stärkere Kombination aus Illustration und Schrift, besonders bei mehrsprachigen Motiven.",
        },
      ],
    } satisfies ComparisonContext,
  },
  "chatgpt-vs-claude-de": {
    name: "ChatGPT vs. Claude (DE) — 4 Use-Cases",
    description: "2-Tool LLM comparison, German, 4 useCaseVerdicts",
    input: {
      tools: [
        {
          slug: "chatgpt",
          name: "ChatGPT",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Assistent",
          iconInitials: "GP",
          iconHue: 160,
        },
        {
          slug: "claude",
          name: "Claude",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Assistent",
          iconInitials: "CL",
          iconHue: 200,
        },
      ],
      verdict: "ChatGPT für Breite, Claude für Tiefe und lange Kontexte.",
      winner: "claude",
      useCaseVerdicts: [
        {
          useCase: "Langer Text analysieren",
          winner: "claude",
          reason: "200K-Kontext-Fenster schlägt GPT-4o bei langen PDFs und Recherche-Dokus.",
        },
        {
          useCase: "Code schreiben & debuggen",
          winner: "chatgpt",
          reason: "Code Interpreter + Plugin-Ökosystem gibt ChatGPT eine praktische Edge.",
        },
        {
          useCase: "Kreatives Schreiben",
          winner: "claude",
          reason: "Differenziertere Sprache, weniger Füllwörter, bessere Strukturvariation.",
        },
        {
          useCase: "Schnelle Alltagsfragen",
          winner: "chatgpt",
          reason: "Breite Plugin-Palette (Web, DALL-E, Wolfram) macht es vielseitiger für Kurzaufgaben.",
        },
      ],
    } satisfies ComparisonContext,
  },
};
