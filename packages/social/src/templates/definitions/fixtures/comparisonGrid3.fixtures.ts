import type { MockFixtureMap } from "../../types.ts";
import type { ComparisonContext } from "../../adapters/comparison.ts";
import type { ComparisonGrid3Generated } from "../comparisonGrid3.ts";

export const COMPARISON_GRID_3_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "Cursor vs. Windsurf vs. Codeium (DE)",
    description: "3-Tool KI-Code-Editor comparison with full useCaseVerdicts, German",
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
      verdict: "Cursor gewinnt für professionelle Teams, Windsurf für Flows, Codeium für Einsteiger ohne Budget.",
      winner: "cursor",
      useCaseVerdicts: [
        { useCase: "Großes Refactoring", winner: "cursor", reason: "Composer-Mode versteht den vollen Codebase-Kontext." },
        { useCase: "Flow-Entwicklung", winner: "windsurf", reason: "Cascade bleibt über mehrstufige Schritte kohärent." },
        { useCase: "Kostenfreier Einstieg", winner: "codeium", reason: "Komplett kostenlos, keine Token-Limits." },
        { useCase: "IDE-Integration", winner: "cursor", reason: "Fork von VS Code — nahtloses Erlebnis ohne Extension." },
        { useCase: "Kleinere Projekte", winner: "windsurf", reason: "Schnellere Autocomplete für kürzere Kontexte." },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Cursor vs. Windsurf vs. Codeium: Wir haben alle drei KI-Code-Editoren im Alltag getestet — hier ist unser ehrliches Fazit.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/cursor-vs-windsurf-vs-codeium",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid3Generated,
  },
  "edge-min": {
    name: "Claude vs. ChatGPT vs. Gemini (minimal)",
    description: "3-Tool LLM comparison without useCaseVerdicts — exercises fallback strengths path",
    input: {
      tools: [
        {
          slug: "claude",
          name: "Claude",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Assistent",
          iconInitials: "CL",
          iconHue: 200,
        },
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
          slug: "gemini",
          name: "Gemini",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Assistent",
          iconInitials: "GE",
          iconHue: 210,
        },
      ],
      verdict: "Drei starke Assistenten — die Wahl hängt vom Workflow ab.",
      useCaseVerdicts: [],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Claude vs. ChatGPT vs. Gemini: Wir haben getestet.\n\n→ toolwiki.ai/llm-vergleich",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid3Generated,
  },
  "edge-max": {
    name: "Perplexity vs. You vs. Phind (DE, long texts)",
    description: "3-Tool comparison with maximum-length text strings — proves no overflow/clipping",
    input: {
      tools: [
        {
          slug: "perplexity",
          name: "Perplexity",
          pricingTier: "freemium",
          priceFrom: 20,
          primaryCategory: "KI-Suchmaschine",
          iconInitials: "PP",
          iconHue: 260,
        },
        {
          slug: "you",
          name: "You.com",
          pricingTier: "freemium",
          priceFrom: 15,
          primaryCategory: "KI-Suchmaschine",
          iconInitials: "YC",
          iconHue: 230,
        },
        {
          slug: "phind",
          name: "Phind",
          pricingTier: "freemium",
          priceFrom: 0,
          primaryCategory: "KI-Suchmaschine",
          iconInitials: "PH",
          iconHue: 290,
        },
      ],
      verdict: "Perplexity führt bei Recherche-Qualität und Quellenangaben, You.com punktet mit Personalisierung und Privacy-Fokus, während Phind speziell für Entwickler mit Code-Kontext und technischen Antworten optimiert ist.",
      winner: "perplexity",
      useCaseVerdicts: [
        {
          useCase: "Echtzeit-Webrecherche mit verifizierbaren Quellen",
          winner: "perplexity",
          reason: "Perplexity liefert die präzisesten Quellenangaben und aktuellsten Informationen — klar der Testsieger bei zeitkritischen Recherchen.",
        },
        {
          useCase: "Entwickler-Fragen und Code-Debugging",
          winner: "phind",
          reason: "Phind versteht technischen Kontext besser und liefert Code-Snippets, die tatsächlich funktionieren.",
        },
        {
          useCase: "Privacy und Datenschutz im Unternehmenseinsatz",
          winner: "you",
          reason: "You.com bietet die stärksten Datenschutz-Einstellungen und verarbeitet keine Suchanfragen für Modell-Training.",
        },
      ],
    } satisfies ComparisonContext,
    generatedContent: {
      caption: "Perplexity vs. You.com vs. Phind: Wir haben alle drei KI-Suchmaschinen ausführlich getestet — in Recherche-Qualität, Entwickler-Features und Datenschutz. Hier ist unser detailliertes Fazit nach wochenlangem Echtbetrieb.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/ki-suchmaschinen-vergleich",
      hashtags: ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies ComparisonGrid3Generated,
  },
};
