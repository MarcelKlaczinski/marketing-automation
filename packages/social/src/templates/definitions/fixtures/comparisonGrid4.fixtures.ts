import type { MockFixtureMap } from "../../types.ts";
import type { ComparisonContext } from "../../adapters/comparison.ts";
import type { ComparisonGrid4Generated } from "../comparisonGrid4.ts";

export const COMPARISON_GRID_4_FIXTURES: MockFixtureMap = {
  characteristic: {
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
    generatedContent: {
      caption: "Recraft vs. Ideogram: Wir haben beide Tools getestet — hier ist unser ehrliches Fazit für KI-Bild-Generierung.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/recraft-vs-ideogram",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid4Generated,
  },
  "edge-min": {
    name: "ChatGPT vs. Claude (DE, no verdicts)",
    description: "2-Tool LLM comparison without useCaseVerdicts — exercises fallback strengths path",
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
    generatedContent: {
      caption: "ChatGPT vs. Claude: Wir haben beide getestet.\n\n→ toolwiki.ai/chatgpt-vs-claude",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid4Generated,
  },
  "edge-max": {
    name: "Gemini vs. Perplexity (DE, long texts)",
    description: "2-Tool comparison with maximum-length text strings — proves no overflow/clipping",
    input: {
      tools: [
        {
          slug: "gemini",
          name: "Gemini",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Assistent",
          iconInitials: "GE",
          iconHue: 210,
        },
        {
          slug: "perplexity",
          name: "Perplexity",
          pricingTier: "freemium",
          priceFrom: 20,
          primaryCategory: "KI-Assistent",
          iconInitials: "PP",
          iconHue: 260,
        },
      ],
      verdict: "Gemini überzeugt durch Google-Integration und Multimodalität, während Perplexity mit Echtzeit-Websuche und präzisen Quellen punktet — je nach Anwendungsfall klar unterschiedliche Stärken.",
      winner: "gemini",
      useCaseVerdicts: [
        {
          useCase: "Echtzeit-Webrecherche mit Quellenangaben",
          winner: "perplexity",
          reason: "Perplexity liefert aktuelle Informationen mit verifizierbaren Links — deutlich besser als Gemini bei zeitkritischen Fragen.",
        },
        {
          useCase: "Multimodale Bildanalyse",
          winner: "gemini",
          reason: "Gemini Ultra erkennt Diagramme, Tabellen und handgeschriebene Notizen präzise — Perplexity hat diese Fähigkeit nicht.",
        },
        {
          useCase: "Google Workspace Integration",
          winner: "gemini",
          reason: "Nahtlose Einbindung in Gmail, Docs und Drive — kein Setup, sofort produktiv im bestehenden Workflow.",
        },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Gemini vs. Perplexity: Wir haben beide KI-Assistenten ausführlich getestet — in Recherche, Multimodalität und Alltagsintegration. Hier ist unser detailliertes, ehrliches Fazit nach Wochen im Echtbetrieb.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/gemini-vs-perplexity",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid4Generated,
  },
};
