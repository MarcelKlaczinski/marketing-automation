import type { MockFixtureMap } from "../../types.ts";
import type { ComparisonContext } from "../../adapters/comparison.ts";
import type { VerdictPerUseCaseGenerated } from "../verdictPerUseCase.ts";

export const USE_CASE_VERDICT_FIXTURES: MockFixtureMap = {
  characteristic: {
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
          reason: "Vektor-Export und Brand-Konsistenz sind hier entscheidend — Recraft liefert beide aus der Box.",
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
          reason: "Stärkere Kombination aus Illustration und Schrift, besonders bei mehrsprachigen Motiven.",
        },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Recraft vs. Ideogram: 5 Use-Cases, 5 ehrliche Empfehlungen. Recraft gewinnt 3 von 5 Use-Cases.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/recraft-vs-ideogram",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#UseCase"],
    } satisfies VerdictPerUseCaseGenerated,
  },
  "edge-min": {
    name: "ChatGPT vs. Claude (DE) — 4 Use-Cases (minimum)",
    description: "2-Tool LLM comparison, German, 4 useCaseVerdicts — minimum valid fixture",
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
          reason: "200K-Kontext-Fenster schlägt GPT-4o bei langen PDFs.",
        },
        {
          useCase: "Code schreiben",
          winner: "chatgpt",
          reason: "Code Interpreter gibt ChatGPT eine praktische Edge.",
        },
        {
          useCase: "Kreatives Schreiben",
          winner: "claude",
          reason: "Differenziertere Sprache, weniger Füllwörter.",
        },
        {
          useCase: "Schnelle Fragen",
          winner: "chatgpt",
          reason: "Breite Plugin-Palette macht es vielseitiger.",
        },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "ChatGPT vs. Claude: 4 Use-Cases getestet.\n\n→ toolwiki.ai/chatgpt-vs-claude",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#UseCase"],
    } satisfies VerdictPerUseCaseGenerated,
  },
  "edge-max": {
    name: "Cursor vs. Windsurf vs. Codeium (DE) — 7 Use-Cases (maximum)",
    description: "3-Tool comparison at maximum 7 verdicts with max-length reason texts — proves no overflow",
    input: {
      tools: [
        {
          slug: "cursor",
          name: "Cursor",
          pricingTier: "freemium",
          priceFrom: 20,
          primaryCategory: "KI-Code-Editor",
          iconInitials: "CU",
          iconHue: 200,
        },
        {
          slug: "windsurf",
          name: "Windsurf",
          pricingTier: "freemium",
          priceFrom: 15,
          primaryCategory: "KI-Code-Editor",
          iconInitials: "WS",
          iconHue: 185,
        },
        {
          slug: "codeium",
          name: "Codeium",
          pricingTier: "free",
          priceFrom: 0,
          primaryCategory: "KI-Code-Editor",
          iconInitials: "CD",
          iconHue: 150,
        },
      ],
      verdict: "Cursor für Teams, Windsurf für Flows, Codeium für Einsteiger.",
      winner: "cursor",
      useCaseVerdicts: [
        {
          useCase: "Großes Refactoring über viele Dateien",
          winner: "cursor",
          reason: "Cursor Composer versteht den vollen Codebase-Kontext und hält Änderungen konsistent über 50+ Dateien hinweg.",
        },
        {
          useCase: "Mehrstufige Feature-Entwicklung im Flow",
          winner: "windsurf",
          reason: "Cascade bleibt über mehrere Entwicklungsschritte kohärent ohne den Kontext zu verlieren.",
        },
        {
          useCase: "Kostenfreier Einstieg ohne Token-Limits",
          winner: "codeium",
          reason: "Codeium ist komplett kostenlos mit unlimitierter Autocomplete — kein Credit-System, kein Paywall.",
        },
        {
          useCase: "IDE-Integration ohne Extra-Setup",
          winner: "cursor",
          reason: "Als Fork von VS Code läuft Cursor direkt mit allen Erweiterungen — kein Plugin-Overhead.",
        },
        {
          useCase: "Autocomplete bei kleineren Projekten",
          winner: "windsurf",
          reason: "Für kürzere Kontexte ist Windsurfs Autocomplete schneller und präziser als Cursors.",
        },
        {
          useCase: "Team-Kollaboration mit geteiltem Kontext",
          winner: "cursor",
          reason: "Cursor Business ermöglicht geteilte Codebase-Indexierung — alle Entwickler im Team nutzen denselben Kontext.",
        },
        {
          useCase: "Schnelle Einzel-Zeilen-Ergänzungen",
          winner: "codeium",
          reason: "Codeiums Ghost-Text-Suggestions sind bei kurzen Completions am reaktionsschnellsten im Test.",
        },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Cursor vs. Windsurf vs. Codeium: 7 Use-Cases, 7 ehrliche Empfehlungen. Cursor gewinnt 3 von 7 Use-Cases.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/cursor-vs-windsurf-vs-codeium",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#UseCase"],
    } satisfies VerdictPerUseCaseGenerated,
  },
};
