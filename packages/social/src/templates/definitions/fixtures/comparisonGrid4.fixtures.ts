import type { MockFixtureMap } from "../../types.ts";
import type { ComparisonContext } from "../../adapters/comparison.ts";

export const COMPARISON_STUNNING_FIXTURES: MockFixtureMap = {
  "recraft-vs-ideogram-de": {
    name: "Recraft vs. Ideogram (DE)",
    description: "2-Tool AI image generator comparison with useCaseVerdicts, German",
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
        { useCase: "Logo-Design", winner: "recraft", reason: "Präziser Vektor-Export, konsistente Brand-Farben." },
        { useCase: "Text im Bild", winner: "ideogram", reason: "Deutlich lesbarere Schrift, weniger Halluzinationen." },
        { useCase: "Social-Media-Posts", winner: "recraft", reason: "Mehr Templates, bessere Format-Kontrolle." },
        { useCase: "Poster-Design", winner: "ideogram", reason: "Stärkere Typografie-Integration." },
        { useCase: "Produktbilder", winner: "recraft", reason: "Sauberere Hintergründe, isolierte Objekte." },
      ],
    } satisfies ComparisonContext,
  },
  "chatgpt-vs-claude-de": {
    name: "ChatGPT vs. Claude (DE)",
    description: "2-Tool LLM comparison without useCaseVerdicts",
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
      verdict: "Beide sind stark — ChatGPT für Breite, Claude für Tiefe und Präzision.",
      useCaseVerdicts: [],
    } satisfies ComparisonContext,
  },
};
