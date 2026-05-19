/**
 * Spec 59.3.5 Section D — Visual harness: render all templates × fixtures × themes.
 *
 * Modes:
 *   bun packages/social/scripts/visual-render-all.ts              → diff against __baselines__/
 *   bun packages/social/scripts/visual-render-all.ts --update     → write/overwrite __baselines__/
 *   bun packages/social/scripts/visual-render-all.ts --out /tmp/x → one-shot render to custom dir
 *
 * Output structure:
 *   __baselines__/<templateKey>/<fixtureName>/<theme>/slide-NN.png
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { brandTokensSchema } from "../src/compositions/list-carousel/types.ts";
import { proConVerdictInputSchema } from "../src/compositions/pro-con-verdict/types.ts";
import { useCaseVerdictInputSchema } from "../src/compositions/verdict-cards/types.ts";
import { singleToolSpotlightInputSchema } from "../src/compositions/single-tool-spotlight/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = resolve(HERE, "../test/__baselines__");

const UPDATE = process.argv.includes("--update");
const CUSTOM_OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
const OUT_DIR = CUSTOM_OUT ?? BASELINE_DIR;
const MODE = CUSTOM_OUT ? "render-only" : UPDATE ? "update" : "check";

const DEFAULT_BRAND = brandTokensSchema.parse({});
const THEMES = ["dark", "light"] as const;

// ---------------------------------------------------------------------------
// Render-server functions (dynamic import — keeps Remotion out of cold boot)
// ---------------------------------------------------------------------------

type RS = {
  renderComparisonGrid: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
  renderVerdictPerUseCase: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
  renderSingleToolSpotlight: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
  renderProConVerdict: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
};

let _rs: RS | null = null;
async function rs(): Promise<RS> {
  if (!_rs) _rs = await import("../render-server.ts") as unknown as RS;
  return _rs;
}

// ---------------------------------------------------------------------------
// Fixture definitions (composition-level inputs, theme-agnostic)
// ---------------------------------------------------------------------------

type FixtureSuite = { name: string; slides: (theme: "dark" | "light") => Promise<Buffer[]> }[];

const suites: { templateKey: string; fixtures: FixtureSuite }[] = [
  // ── comparison-grid-4 ──────────────────────────────────────────────────
  {
    templateKey: "comparison-grid-4",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "Recraft",
              headlineHighlight: "oder Ideogram?",
              hookOutput: {
                pattern: "superlative_question" as const,
                leadPhrase: "Recraft",
                highlightWord: "oder Ideogram?",
                trailPhrase: "",
                fullText: "Recraft oder Ideogram?",
                promiseBlock: { line1: "Beide KI-Bildgeneratoren im Test.", line2: "Kein Hype. Echte Ergebnisse." },
              },
            },
            tools: [
              { slug: "recraft", rank: 1, name: "Recraft", domain: "recraft.ai", eyebrow: "01 · KI-BILD-GENERATOR", tagline: "Präziser Vektor-Export und konsistente Brand-Farben direkt aus der Box.", strengths: ["Logo-Design", "Social-Media-Posts", "Produktbilder"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, starStrength: "Logo-Design", bestFor: "Vektor-Design", iconInitials: "RC", iconHue: 220 },
              { slug: "ideogram", rank: 2, name: "Ideogram", domain: "ideogram.ai", eyebrow: "02 · KI-BILD-GENERATOR", tagline: "Stärkere Typografie-Integration für Text-im-Bild-Motive.", strengths: ["Text im Bild", "Poster-Design"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, bestFor: "Text im Bild", iconInitials: "ID", iconHue: 280 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/recraft-vs-ideogram", toolRecap: ["recraft", "ideogram"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "ChatGPT",
              headlineHighlight: "oder Claude?",
              hookOutput: { pattern: "superlative_question" as const, leadPhrase: "ChatGPT", highlightWord: "oder Claude?", trailPhrase: "", fullText: "ChatGPT oder Claude?", promiseBlock: { line1: "Beide KI-Assistenten im Test.", line2: "Kein Hype. Echte Ergebnisse." } },
            },
            tools: [
              { slug: "chatgpt", rank: 1, name: "ChatGPT", domain: "chat.openai.com", eyebrow: "01 · KI-ASSISTENT", tagline: "KI-Assistent für breite Alltagsaufgaben.", strengths: ["Breite Anwendung", "Plugins"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, iconInitials: "GP", iconHue: 160 },
              { slug: "claude", rank: 2, name: "Claude", domain: "claude.ai", eyebrow: "02 · KI-ASSISTENT", tagline: "Tiefe Reasoning-Stärken und lange Kontexte.", strengths: ["Langer Kontext", "Präzision"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, iconInitials: "CL", iconHue: 200 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/chatgpt-vs-claude", toolRecap: ["chatgpt", "claude"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "Gemini",
              headlineHighlight: "oder Perplexity?",
              hookOutput: { pattern: "superlative_question" as const, leadPhrase: "Gemini", highlightWord: "oder Perplexity?", trailPhrase: "", fullText: "Gemini oder Perplexity?", promiseBlock: { line1: "KI-Suche und Multimodalität im Direkttest.", line2: "Kein Hype. Echte Ergebnisse." } },
            },
            tools: [
              { slug: "gemini", rank: 1, name: "Gemini", domain: "gemini.google.com", eyebrow: "01 · KI-ASSISTENT", tagline: "Nahtlose Google-Integration und starke multimodale Bildanalyse direkt aus der Box.", strengths: ["Multimodale Bildanalyse", "Google Workspace", "Echtzeit-Suche"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, starStrength: "Google Workspace Integration", bestFor: "Google-Nutzer", iconInitials: "GE", iconHue: 210 },
              { slug: "perplexity", rank: 2, name: "Perplexity", domain: "perplexity.ai", eyebrow: "02 · KI-SUCHMASCHINE", tagline: "Aktuelle Informationen mit verifizierbaren Links für zeitkritische Recherchen.", strengths: ["Echtzeit-Websuche", "Quellenangaben", "Forschungsrecherche"], pricing: { tier: "freemium" as const, label: "ab 20 €/Mo" }, starStrength: "Echtzeit-Webrecherche mit Quellenangaben", bestFor: "Recherche", iconInitials: "PP", iconHue: 260 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/gemini-vs-perplexity", toolRecap: ["gemini", "perplexity"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
    ],
  },

  // ── comparison-grid-3 ──────────────────────────────────────────────────
  {
    templateKey: "comparison-grid-3",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "Cursor vs.",
              headlineHighlight: "Windsurf vs. Codeium",
              hookOutput: { pattern: "superlative_question" as const, leadPhrase: "Cursor vs.", highlightWord: "Windsurf vs. Codeium", trailPhrase: "", fullText: "Cursor vs. Windsurf vs. Codeium", promiseBlock: { line1: "Drei KI-Code-Editoren im Vergleich.", line2: "Kein Hype. Echte Ergebnisse." } },
            },
            tools: [
              { slug: "cursor", rank: 1, name: "Cursor", domain: "cursor.sh", eyebrow: "01 · KI-CODE-EDITOR", tagline: "Composer-Mode versteht den vollen Codebase-Kontext für großes Refactoring.", strengths: ["Großes Refactoring", "IDE-Integration", "Team-Kollaboration"], pricing: { tier: "freemium" as const, label: "ab 20 €/Mo" }, starStrength: "Großes Refactoring", bestFor: "Teams", iconInitials: "CU", iconHue: 200 },
              { slug: "windsurf", rank: 2, name: "Windsurf", domain: "codeium.com/windsurf", eyebrow: "02 · KI-CODE-EDITOR", tagline: "Cascade bleibt über mehrstufige Flow-Schritte kohärent.", strengths: ["Flow-Entwicklung", "Autocomplete"], pricing: { tier: "freemium" as const, label: "ab 15 €/Mo" }, starStrength: "Flow-Entwicklung", bestFor: "Flows", iconInitials: "WS", iconHue: 185 },
              { slug: "codeium", rank: 3, name: "Codeium", domain: "codeium.com", eyebrow: "03 · KI-CODE-EDITOR", tagline: "Komplett kostenlos ohne Token-Limits für Einsteiger.", strengths: ["Kostenfreier Einstieg", "Ghost-Text-Completions"], pricing: { tier: "free" as const, label: "Kostenlos" }, bestFor: "Einsteiger", iconInitials: "CD", iconHue: 150 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/cursor-vs-windsurf-vs-codeium", toolRecap: ["cursor", "windsurf", "codeium"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "Welches Tool",
              headlineHighlight: "gewinnt?",
              hookOutput: { pattern: "superlative_question" as const, leadPhrase: "Welches Tool", highlightWord: "gewinnt?", trailPhrase: "", fullText: "Welches Tool gewinnt?", promiseBlock: { line1: "Claude vs. ChatGPT vs. Gemini.", line2: "Kein Hype. Echte Ergebnisse." } },
            },
            tools: [
              { slug: "claude", rank: 1, name: "Claude", domain: "claude.ai", eyebrow: "01 · KI-ASSISTENT", tagline: "Tiefe Analyse.", strengths: ["Langer Kontext", "Präzision"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, iconInitials: "CL", iconHue: 200 },
              { slug: "chatgpt", rank: 2, name: "ChatGPT", domain: "chat.openai.com", eyebrow: "02 · KI-ASSISTENT", tagline: "Breite Anwendung.", strengths: ["Plugins", "Vielseitig"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, iconInitials: "GP", iconHue: 160 },
              { slug: "gemini", rank: 3, name: "Gemini", domain: "gemini.google.com", eyebrow: "03 · KI-ASSISTENT", tagline: "Google-Integration.", strengths: ["Google-Suite", "Kostenlos"], pricing: { tier: "free" as const, label: "Kostenlos" }, iconInitials: "GE", iconHue: 210 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/llm-vergleich", toolRecap: ["claude", "chatgpt", "gemini"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = {
            theme, variant: "stunning" as const, brandTokens: DEFAULT_BRAND, slideIndex: 0,
            locale: "de",
            cover: {
              eyebrow: "TOOL-VERGLEICH · 2026",
              headlineLead: "Perplexity vs. You",
              headlineHighlight: "vs. Phind — KI-Suche",
              hookOutput: { pattern: "superlative_question" as const, leadPhrase: "Perplexity vs. You", highlightWord: "vs. Phind", trailPhrase: "", fullText: "Perplexity vs. You.com vs. Phind", promiseBlock: { line1: "Drei KI-Suchmaschinen im Direkttest.", line2: "Kein Hype. Echte Ergebnisse." } },
            },
            tools: [
              { slug: "perplexity", rank: 1, name: "Perplexity", domain: "perplexity.ai", eyebrow: "01 · KI-SUCHMASCHINE", tagline: "Perplexity liefert aktuelle Informationen mit verifizierbaren Links für zeitkritische Recherchen.", strengths: ["Echtzeit-Webrecherche mit Quellenangaben", "Forschungsrecherche", "Faktenprüfung"], pricing: { tier: "freemium" as const, label: "ab 20 €/Mo" }, starStrength: "Echtzeit-Webrecherche mit verifizierbaren Quellen", bestFor: "Recherche", iconInitials: "PP", iconHue: 260 },
              { slug: "you", rank: 2, name: "You.com", domain: "you.com", eyebrow: "02 · KI-SUCHMASCHINE", tagline: "You.com bietet die stärksten Datenschutz-Einstellungen im Unternehmenseinsatz.", strengths: ["Privacy & Datenschutz", "Personalisierung"], pricing: { tier: "freemium" as const, label: "ab 15 €/Mo" }, bestFor: "Datenschutz", iconInitials: "YC", iconHue: 230 },
              { slug: "phind", rank: 3, name: "Phind", domain: "phind.com", eyebrow: "03 · KI-SUCHMASCHINE", tagline: "Phind versteht technischen Kontext besser und liefert Code-Snippets die tatsächlich funktionieren.", strengths: ["Code-Debugging", "Entwickler-Fragen"], pricing: { tier: "freemium" as const, label: "ab 0 €" }, bestFor: "Entwickler", iconInitials: "PH", iconHue: 290 },
            ],
            end: { headline: "Mehr Reviews,", headlineHighlight: "ehrlich getestet.", articleUrl: "toolwiki.ai/ki-suchmaschinen-vergleich", toolRecap: ["perplexity", "you", "phind"] },
          };
          return (await rs()).renderComparisonGrid(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
    ],
  },

  // ── verdict-per-use-case ───────────────────────────────────────────────
  {
    templateKey: "verdict-per-use-case",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = useCaseVerdictInputSchema.parse({
            theme, locale: "de", slideIndex: 0,
            websiteUrl: "toolwiki.ai", instagramHandle: "@toolwiki.ai",
            articleSlug: "recraft-vs-ideogram",
            tools: [
              { slug: "recraft", name: "Recraft", iconInitials: "RC", iconHue: 220 },
              { slug: "ideogram", name: "Ideogram", iconInitials: "ID", iconHue: 280 },
            ],
            verdicts: [
              { useCase: "Logo-Design für Brand-Identität", winner: "recraft", reason: "Vektor-Export und Brand-Konsistenz sind hier entscheidend — Recraft liefert beide aus der Box." },
              { useCase: "Text im Bild (z.B. Poster, Meme)", winner: "ideogram", reason: "Ideograms Typografie-Kontrolle ist klar überlegen. Weniger Halluzinationen bei Buchstaben." },
              { useCase: "Social-Media-Posts", winner: "recraft", reason: "Mehr vorgefertigte Formate, bessere Pixel-Kontrolle für Quadrat-Zuschnitte." },
              { useCase: "Produktbilder (Freisteller)", winner: "recraft", reason: "Sauberere Hintgrundremovals, konsistentere Objektisolation bei komplexen Formen." },
              { useCase: "Poster-Design & Kampagnen", winner: "ideogram", reason: "Stärkere Kombination aus Illustration und Schrift, besonders bei mehrsprachigen Motiven." },
            ],
          });
          return (await rs()).renderVerdictPerUseCase(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = useCaseVerdictInputSchema.parse({
            theme, locale: "de", slideIndex: 0,
            websiteUrl: "toolwiki.ai", instagramHandle: "@toolwiki.ai",
            articleSlug: "chatgpt-vs-claude",
            tools: [
              { slug: "chatgpt", name: "ChatGPT", iconInitials: "GP", iconHue: 160 },
              { slug: "claude", name: "Claude", iconInitials: "CL", iconHue: 200 },
            ],
            verdicts: [
              { useCase: "Langer Text", winner: "claude", reason: "200K-Kontext-Fenster schlägt GPT-4o bei langen PDFs." },
              { useCase: "Code schreiben", winner: "chatgpt", reason: "Code Interpreter gibt ChatGPT eine praktische Edge." },
              { useCase: "Kreatives Schreiben", winner: "claude", reason: "Differenziertere Sprache, weniger Füllwörter." },
            ],
          });
          return (await rs()).renderVerdictPerUseCase(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = useCaseVerdictInputSchema.parse({
            theme, locale: "de", slideIndex: 0,
            websiteUrl: "toolwiki.ai", instagramHandle: "@toolwiki.ai",
            articleSlug: "cursor-vs-windsurf-vs-codeium",
            tools: [
              { slug: "cursor", name: "Cursor", iconInitials: "CU", iconHue: 200 },
              { slug: "windsurf", name: "Windsurf", iconInitials: "WS", iconHue: 185 },
              { slug: "codeium", name: "Codeium", iconInitials: "CD", iconHue: 150 },
            ],
            verdicts: [
              { useCase: "Großes Refactoring über viele Dateien", winner: "cursor", reason: "Cursor Composer versteht den vollen Codebase-Kontext und hält Änderungen konsistent über 50+ Dateien hinweg." },
              { useCase: "Mehrstufige Feature-Entwicklung im Flow", winner: "windsurf", reason: "Cascade bleibt über mehrere Entwicklungsschritte kohärent ohne den Kontext zu verlieren." },
              { useCase: "Kostenfreier Einstieg ohne Token-Limits", winner: "codeium", reason: "Codeium ist komplett kostenlos mit unlimitierter Autocomplete — kein Credit-System, kein Paywall." },
              { useCase: "IDE-Integration ohne Extra-Setup", winner: "cursor", reason: "Als Fork von VS Code läuft Cursor direkt mit allen Erweiterungen — kein Plugin-Overhead." },
              { useCase: "Autocomplete bei kleineren Projekten", winner: "windsurf", reason: "Für kürzere Kontexte ist Windsurfs Autocomplete schneller und präziser als Cursors." },
              { useCase: "Team-Kollaboration mit geteiltem Kontext", winner: "cursor", reason: "Cursor Business ermöglicht geteilte Codebase-Indexierung — alle Entwickler im Team nutzen denselben Kontext." },
              { useCase: "Schnelle Einzel-Zeilen-Ergänzungen", winner: "codeium", reason: "Codeiums Ghost-Text-Suggestions sind bei kurzen Completions am reaktionsschnellsten im Test." },
            ],
          });
          return (await rs()).renderVerdictPerUseCase(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
    ],
  },

  // ── single-tool-spotlight ──────────────────────────────────────────────
  {
    templateKey: "single-tool-spotlight",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            theme, locale: "de", slideIndex: 0, totalSlides: 5,
            brandTokens: DEFAULT_BRAND, articleSlug: "chatgpt",
            tool: {
              slug: "chatgpt", name: "ChatGPT",
              tagline: "Der bekannteste KI-Assistent der Welt — für Text, Code und Recherche.",
              primaryCategory: "KI-Assistent", pricingTier: "freemium", priceFrom: 20, rating: 4.6,
              pros: [{ text: "Stärkste Sprachmodelle (GPT-4o, o1)" }, { text: "Riesige Plugin- und GPT-Bibliothek" }, { text: "Beste Coding-Unterstützung im Free-Tier" }, { text: "Multimodal: Text, Bild, Audio, Video" }, { text: "API mit günstigsten Token-Kosten" }],
              cons: [{ text: "Datenschutz: Opt-out nötig für Training" }, { text: "Kontext-Limit bei langen Gesprächen" }, { text: "Halluziniert bei sehr spezifischen Fakten" }],
              features: ["GPT-4o und o1 Reasoning-Modell", "DALL-E 3 Bildgenerierung integriert", "Code Interpreter mit Python-Ausführung", "Custom GPTs baubar", "Plugins und Tools-Ecosystem", "Web-Browsing in Echtzeit"],
              useCases: ["Texte schreiben und überarbeiten", "Code debuggen und generieren", "Recherche und Zusammenfassungen", "Bilder generieren mit DALL-E 3"],
              iconInitials: "GP", iconHue: 160,
            },
          });
          return (await rs()).renderSingleToolSpotlight(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            theme, locale: "de", slideIndex: 0, totalSlides: 4,
            brandTokens: DEFAULT_BRAND, articleSlug: "simple-tool",
            tool: {
              slug: "simple-tool", name: "SimpleTool", pricingTier: "free",
              pros: [{ text: "Kostenlos nutzbar ohne Registrierung" }, { text: "Funktioniert in jedem Browser" }],
              cons: [], features: [],
              useCases: ["Schnelle Textzusammenfassungen"],
              iconInitials: "ST", iconHue: 190,
            },
          });
          return (await rs()).renderSingleToolSpotlight(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            theme, locale: "de", slideIndex: 0, totalSlides: 5,
            brandTokens: DEFAULT_BRAND, articleSlug: "megatool-pro",
            tool: {
              slug: "mega-tool", name: "MegaTool Pro",
              tagline: "Enterprise-Plattform mit KI-gestützter Automatisierung für skalierbare Workflows.",
              primaryCategory: "KI-Workflow", pricingTier: "enterprise", priceFrom: 299, rating: 4.2,
              pros: [{ text: "SOC2 Type II + DSGVO-konform zertifiziert" }, { text: "Unbegrenzte Workspaces und Nutzer" }, { text: "REST API + Webhooks für alle Aktionen" }, { text: "On-Premise-Deployment auf eigenen Servern" }, { text: "Dedizierter Enterprise-Support 24/7" }],
              cons: [{ text: "Steile Lernkurve bei komplexen Workflows" }, { text: "Onboarding dauert 2–4 Wochen" }, { text: "Keine Mobile-App verfügbar" }, { text: "Preis für KMUs schwer rechtfertigbar" }],
              features: ["Visueller Drag-and-Drop Workflow-Builder", "KI-gestützte Anomalie-Erkennung in Echtzeit", "Multi-Cloud-Connector: AWS, Azure, GCP", "Granulare RBAC-Berechtigungen", "Audit-Trail mit 90-Tage-Retention", "White-Label und Custom-Domain-Support"],
              useCases: ["Automatisierung komplexer Unternehmens-Workflows", "Compliance-Monitoring und Audit-Reporting", "Multi-Cloud-Datenintegration und ETL", "Echtzeit-Anomalie-Erkennung in Produktionssystemen"],
              iconInitials: "MP", iconHue: 280,
            },
          });
          return (await rs()).renderSingleToolSpotlight(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
    ],
  },

  // ── pro-con-verdict ────────────────────────────────────────────────────
  {
    templateKey: "pro-con-verdict",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = proConVerdictInputSchema.parse({
            theme, locale: "de", slideIndex: 0, totalSlides: 5, brandTokens: DEFAULT_BRAND,
            tool: { name: "Loom" },
            pros: ["Async-Video direkt im Browser, kein Schnitt nötig", "Auto-Transkription in 50+ Sprachen", "Integriert sich in Slack, Notion, Linear", "Saubere Sharing-Links statt Datei-Anhänge"],
            cons: ["Free-Tier auf 5 Min/Video begrenzt", "Editor schwach für längere Tutorials", "Keine echte Live-Recording-Option"],
            verdict: { snippet: "Solide für schnelle Async-Updates, schwach für Tutorial-Macher", whenToUse: "Wenn du regelmäßig kurze Status-Videos für Teams brauchst und Slack-Integration zentral ist.", whenToSkip: "Wenn du längere strukturierte Tutorials produzierst oder Live-Streaming brauchst." },
          });
          return (await rs()).renderProConVerdict(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = proConVerdictInputSchema.parse({
            theme, locale: "en", slideIndex: 0, totalSlides: 5, brandTokens: DEFAULT_BRAND,
            tool: { name: "Tool X" },
            pros: ["Pro one here", "Pro two here", "Pro three here"],
            cons: ["Con one here", "Con two here", "Con three here"],
            verdict: { snippet: "Decent for X, weak for Y", whenToUse: "Use it for A. Skip if you need B.", whenToSkip: "Skip if you need C. Look at D instead." },
          });
          return (await rs()).renderProConVerdict(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = proConVerdictInputSchema.parse({
            theme, locale: "en", slideIndex: 0, totalSlides: 5, brandTokens: DEFAULT_BRAND,
            tool: { name: "Maximum Length Tool Name That Tests Layout" },
            pros: ["First pro at maximum allowed character count — testing wrapping at the upper bound", "Second pro at maximum allowed character count — testing wrapping at the upper bound", "Third pro at maximum allowed character count — testing wrapping at the upper bound", "Fourth pro at maximum allowed character count — testing wrapping at upper bound", "Fifth pro at maximum allowed character count — testing wrapping at the upper bound"],
            cons: ["First con at maximum allowed character count — testing wrapping at the upper bound", "Second con at maximum allowed character count — testing wrapping at the upper bound", "Third con at maximum allowed character count — testing wrapping at the upper bound", "Fourth con at maximum allowed character count — testing wrapping at upper bound", "Fifth con at maximum allowed character count — testing wrapping at the upper bound"],
            verdict: { snippet: "Solid for serious teams that have specific advanced workflow requirements", whenToUse: "When you need a deep workflow integration with specific advanced requirements. Best for established teams with clear processes and real budget.", whenToSkip: "If you're a solo founder or small team without complex workflow needs. The setup overhead and pricing make it overkill — try simpler alternatives." },
          });
          return (await rs()).renderProConVerdict(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Render + diff logic
// ---------------------------------------------------------------------------

function parsePng(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

function diffPngs(actual: Buffer, baseline: Buffer): { diffPct: number } {
  const a = parsePng(actual);
  const b = parsePng(baseline);
  if (a.width !== b.width || a.height !== b.height) {
    return { diffPct: 100 };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatch = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  return { diffPct: (mismatch / (a.width * a.height)) * 100 };
}

async function baselineExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n🎨 Visual harness — mode: ${MODE.toUpperCase()}`); // biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`   Output: ${OUT_DIR}\n`); // biome-ignore lint/suspicious/noConsoleLog: script output

let totalSlides = 0;
let passedDiffs = 0;
let failedDiffs = 0;
const failures: string[] = [];

for (const suite of suites) {
  console.log(`\n▶ ${suite.templateKey}`); // biome-ignore lint/suspicious/noConsoleLog: script output

  for (const fixture of suite.fixtures) {
    for (const theme of THEMES) {
      const label = `  ${fixture.name} / ${theme}`;
      process.stdout.write(`${label} … `);

      let slides: Buffer[];
      try {
        slides = await fixture.slides(theme);
      } catch (err) {
        console.log(`❌ render failed: ${String(err)}`); // biome-ignore lint/suspicious/noConsoleLog: script output
        failures.push(`${suite.templateKey}/${fixture.name}/${theme}: render error`);
        continue;
      }

      const slideDir = resolve(OUT_DIR, suite.templateKey, fixture.name, theme);
      await mkdir(slideDir, { recursive: true });

      let slideFail = false;
      for (let i = 0; i < slides.length; i++) {
        const fname = `slide-${String(i + 1).padStart(2, "0")}.png`;
        const outPath = resolve(slideDir, fname);

        if (MODE === "update" || MODE === "render-only") {
          await writeFile(outPath, slides[i]!);
          totalSlides++;
        } else {
          // check mode: diff against existing baseline
          if (!(await baselineExists(outPath))) {
            // No baseline yet — write it (first run)
            await writeFile(outPath, slides[i]!);
            totalSlides++;
          } else {
            const baseline = await readFile(outPath);
            const { diffPct } = diffPngs(slides[i]!, baseline);
            totalSlides++;
            if (diffPct > 0.1) {
              slideFail = true;
              failures.push(`${suite.templateKey}/${fixture.name}/${theme}/${fname}: ${diffPct.toFixed(2)}% pixels differ`);
            } else {
              passedDiffs++;
            }
          }
        }
      }

      if (slideFail) {
        failedDiffs += slides.length;
        console.log(`❌ diff exceeded threshold`); // biome-ignore lint/suspicious/noConsoleLog: script output
      } else {
        console.log(`✓ ${slides.length} slides`); // biome-ignore lint/suspicious/noConsoleLog: script output
      }
    }
  }
}

console.log(`\n${"─".repeat(56)}`); // biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`Total slides rendered: ${totalSlides}`); // biome-ignore lint/suspicious/noConsoleLog: script output

if (MODE === "check" && (passedDiffs + failedDiffs) > 0) {
  console.log(`Diffs passed: ${passedDiffs}  failed: ${failedDiffs}`); // biome-ignore lint/suspicious/noConsoleLog: script output
}

if (failures.length > 0) {
  console.log("\n❌ Failures:"); // biome-ignore lint/suspicious/noConsoleLog: script output
  for (const f of failures) console.log(`   ${f}`); // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n   To update baselines: bun run test:visual:update`); // biome-ignore lint/suspicious/noConsoleLog: script output
  process.exit(1);
} else {
  console.log(`\n✅ Done — PNGs written to ${OUT_DIR}`); // biome-ignore lint/suspicious/noConsoleLog: script output
  if (MODE !== "render-only") console.log(`   open "${OUT_DIR}"`); // biome-ignore lint/suspicious/noConsoleLog: script output
}
