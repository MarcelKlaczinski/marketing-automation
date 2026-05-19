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
  renderComparisonGrid3: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
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

  // ── comparison-grid-3 (single-still, Spec 60.3) ───────────────────────
  // Uses renderComparisonGrid3 — NOT renderComparisonGrid (that's the list-carousel renderer).
  // Input shape: ComparisonGrid3Input { slideIndex, locale, theme, generated, brandTokens }.
  // Matches canonical fixtures in comparisonGrid3.fixtures.ts exactly.
  {
    templateKey: "comparison-grid-3",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = {
            slideIndex: 0,
            locale: "de",
            theme,
            brandTokens: DEFAULT_BRAND,
            generated: {
              headline: "Die",
              headlineEm: "drei Schulen",
              subline: "Ästhetik, Prompt-Adhärenz oder Kontrolle — jedes Tool steht für eine andere Philosophie.",
              eyebrow: "Vergleich · 3 Top-Modelle",
              slideNum: "01 / 01",
              ctaLine1: "Workflow-Empfehlungen →",
              ctaLine2: "toolwiki.ai/bilder",
              dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
              tools: [
                { name: "Midjourney v7", meta: "Premium-Ästhetik · web + Discord", score: 92, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "10 $/Mo", isWinner: true, winnerFlagText: "Top Aesthetic", pros: ["Hero-Visuals out-of-the-box auf Agentur-Niveau", "--sref & --cref für Marken-Konsistenz"], cons: ["Schwer aus dem MJ-Look auszubrechen", "Text im Bild bleibt schwach"], iconInitials: "MJ", iconHue: 220 },
                { name: "DALL·E 4", meta: "Prompt-Adhärenz · via ChatGPT", score: 81, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "20 $/Mo", isWinner: false, pros: ["Liefert exakt was du beschreibst", "Text endlich lesbar"], cons: ["Stil oft glatt, austauschbar", "Weniger Stil-Kontrolle"], iconInitials: "DE", iconHue: 160 },
                { name: "Stable Diffusion", meta: "Maximale Kontrolle · ComfyUI", score: 74, scoreTier: "mid", pricePrefix: "", priceAmount: "Kostenlos", isWinner: false, pros: ["LoRAs für 98% Charakter-Konsistenz", "Kein Abo, keine Quota, lokal"], cons: ["Steile Lernkurve (Hardware + Nodes)", "SD-Default wirkt blass ohne LoRA"], iconInitials: "SD", iconHue: 270 },
              ],
            },
          };
          return (await rs()).renderComparisonGrid3(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = {
            slideIndex: 0,
            locale: "en",
            theme,
            brandTokens: DEFAULT_BRAND,
            generated: {
              headline: "Three AI",
              headlineEm: "writing tools",
              subline: "GPT-4o, Claude, and Gemini compared head-to-head — pros, cons, and who wins for which job.",
              eyebrow: "Comparison · 3 tools",
              slideNum: "01 / 01",
              ctaLine1: "Workflow recommendations →",
              ctaLine2: "toolwiki.ai/ai-assistants",
              dateLabel: "As of 05/2026 · toolwiki.ai/ai-assistants",
              tools: [
                { name: "GPT-4o", meta: "Best all-rounder · ChatGPT", score: 91, scoreTier: "hi", pricePrefix: "From", priceAmount: "$20/mo", isWinner: false, pros: ["Best at creative tasks", "Widest plugin ecosystem"], cons: ["No free tier for GPT-4o", "Context window limited"], iconInitials: "GP", iconHue: 120 },
                { name: "Claude", meta: "Long context · Anthropic", score: 89, scoreTier: "hi", pricePrefix: "From", priceAmount: "$20/mo", isWinner: false, pros: ["200k context window", "Strong at analysis"], cons: ["No image generation", "Fewer integrations"], iconInitials: "CL", iconHue: 200 },
                { name: "Gemini", meta: "Google Search · native", score: 75, scoreTier: "mid", pricePrefix: "", priceAmount: "Free", isWinner: false, pros: ["Free with Google account", "Live web access"], cons: ["Inconsistent quality", "Limited creative range"], iconInitials: "GM", iconHue: 45 },
              ],
            },
          };
          return (await rs()).renderComparisonGrid3(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = {
            slideIndex: 0,
            locale: "de",
            theme,
            brandTokens: DEFAULT_BRAND,
            generated: {
              headline: "Video-KI",
              headlineEm: "im Praxistest",
              subline: "Drei Monate Praxistest mit 80 echten Produktionsprojekten — von kurzen Reels bis zu 10-Minuten-Explainern. Das sind die Ergebnisse.",
              eyebrow: "Vergleich · 3 Video-Generatoren",
              slideNum: "01 / 01",
              ctaLine1: "Vollständiger Praxistest →",
              ctaLine2: "toolwiki.ai/video-ki",
              dateLabel: "Stand 05/2026 · toolwiki.ai/video-ki",
              tools: [
                { name: "Runway Gen-4", meta: "Cinematic Quality · Professionals", score: 88, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "15 $/Mo", isWinner: true, winnerFlagText: "Profi-Empfehlung", pros: ["Beste Motion-Konsistenz bei langen Szenen", "Director Mode für präzise Kamera-Kontrolle"], cons: ["Teuerste Option im Vergleich bei hohem Vol.", "Render-Zeiten bei 4K über 5 Minuten/Clip"], iconInitials: "RW", iconHue: 300 },
                { name: "Kling AI 2.0", meta: "Photorealism · API-first Platform", score: 82, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "0.14 $/Clip", isWinner: false, pros: ["Fotorealistischste Gesichter im Vergleich", "Pay-per-Clip — ideal für kleines Volumen"], cons: ["Kein konsistenter Charakter über Clips", "API-Dokumentation noch lückenhaft"], iconInitials: "KL", iconHue: 180 },
                { name: "Hailuo MiniMax", meta: "Speed & Cost · High Volume", score: 61, scoreTier: "lo", pricePrefix: "", priceAmount: "Kostenlos (Beta)", isWinner: false, pros: ["Schnellste Generierung im Test (unter 60s)", "Kostenlose Beta ohne Warteliste"], cons: ["Qualität für professionelle Nutzung schwach", "Datenschutz-Bestimmungen unklar (China)"], iconInitials: "HL", iconHue: 60 },
              ],
            },
          };
          return (await rs()).renderComparisonGrid3(input as unknown as Record<string, unknown>).then(r => r.slides);
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
  // Uses SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES (cover/body/end schema, Spec 60.1).
  {
    templateKey: "single-tool-spotlight",
    fixtures: [
      {
        name: "characteristic",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            ...{
              slideIndex: 0,
              slideTotal: 3,
              cover: null,
              body: {
                eyebrow: "Deep Dive · Tool-Portrait",
                headerNum: "Test 04/2026 · 50k+ Generierungen",
                slideIndex: 1,
                slideTotal: 3,
                tool: { logo: "", name: "Midjourney", version: "v7 · Premium-Ästhetik", isLive: true },
                verdictQuote: "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
                score: 92,
                scoreLabel: "Top Aesthetic",
                facts: [
                  { key: "Pricing", value: "Ab 10 $/Mo" },
                  { key: "Standard", value: "30 $ · 15h GPU" },
                  { key: "Für wen", value: "Marketing" },
                  { key: "Commercial", value: "Ab Basic" },
                ],
                strengths: [
                  "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
                  "--sref für konsistenten Brand-Look.",
                  "Subtile Hauttöne, anspruchsvolles Licht.",
                  "API seit v6.1 für Studio-Pipelines.",
                ],
                weaknesses: [
                  "Text im Bild bleibt schwach (→ Ideogram).",
                  "Schwer aus dem MJ-Look auszubrechen.",
                  "--cref max. 85 % Charakter-Ähnlichkeit.",
                  "Komposition kippt aus Stil-Bias.",
                ],
                footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
              },
              end: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
              locale: "de",
            },
            theme,
            brandTokens: DEFAULT_BRAND as Record<string, unknown>,
          });
          return (await rs()).renderSingleToolSpotlight(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-min",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            ...{
              slideIndex: 0,
              slideTotal: 2,
              cover: null,
              body: {
                eyebrow: "Deep Dive · Tool",
                headerNum: "Test 05/2026 · Min-Tool",
                slideIndex: 0,
                slideTotal: 2,
                tool: { logo: "", name: "MinTool", version: "v1.0 · Kostenlos", isLive: false },
                verdictQuote: "Für schnelle Browser-Experimente ohne Setup die erste Wahl.",
                score: 61,
                scoreLabel: "Solid Starter",
                facts: [
                  { key: "Preis", value: "Kostenlos" },
                  { key: "Plan", value: "Free Tier" },
                  { key: "Für wen", value: "Einsteiger" },
                  { key: "APIs", value: "Nicht da" },
                ],
                strengths: [
                  "Kostenlos nutzbar ohne Anmeldung nötig.",
                  "Läuft im Browser ohne Installation.",
                  "Schnelle Ergebnisse unter 10 Sekunden.",
                ],
                weaknesses: [
                  "Kein Export in Vektorformat verfügbar.",
                  "Nur 5 Generierungen pro Tag kostenlos.",
                  "Keine API für Entwickler vorhanden.",
                ],
                footer: { ctaLine: "Zum kostenlosen Test →", url: "toolwiki.ai/min-tool" },
              },
              end: { ctaLine: "Zum kostenlosen Test →", url: "toolwiki.ai/min-tool" },
              locale: "de",
            },
            theme,
            brandTokens: DEFAULT_BRAND as Record<string, unknown>,
          });
          return (await rs()).renderSingleToolSpotlight(input as unknown as Record<string, unknown>).then(r => r.slides);
        },
      },
      {
        name: "edge-max",
        slides: async (theme) => {
          const input = singleToolSpotlightInputSchema.parse({
            ...{
              slideIndex: 0,
              slideTotal: 3,
              cover: {
                eyebrow: "Enterprise · Deep Dive",
                headerNum: "Audit 05/2026 · MaximumLengthT",
                updateBadge: "Stand: Mai 2026",
                heroTitle: "Enterprise KI",
                kicker: "Vollständiger Test einer Enterprise-KI-Plattform mit SOC2, RBAC, Multi-Cloud und 24/7-Support.",
                toolLogos: [{ src: "", alt: "MaximumLengthT" }],
                toolsMoreText: "+ 3 weitere",
                stats: [
                  { value: "SOC", label: "Type II zertifiziert" },
                  { value: "99%", label: "SLA-Verfügbarkeit" },
                  { value: "90d", label: "Audit-Trail-Retention" },
                ],
                byline: {
                  initials: "MK",
                  name: "Marcel Klaczinski",
                  role: "Editor · Enterprise & Compliance",
                  readTime: "18 Min Lesen",
                },
                swipeText: "Swipe für den Deep Dive",
                footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/enterprise" },
              },
              body: {
                eyebrow: "Enterprise · Deep Dive",
                headerNum: "Audit 05/2026 · MaximumLengthT",
                slideIndex: 1,
                slideTotal: 3,
                tool: { logo: "", name: "MaximumLengthT", version: "v4.2 Enterprise · SOC2 certified", isLive: true },
                verdictQuote: "Für Enterprise-Teams mit Compliance-Anforderungen die technisch stärkste Plattform.",
                score: 84,
                scoreLabel: "Enterprise Pick",
                facts: [
                  { key: "Preis/Mo", value: "Ab 499 $/Mo" },
                  { key: "Zertifikat", value: "SOC2 + DSGVO" },
                  { key: "Für wen", value: "Enterprise" },
                  { key: "Support", value: "24/7 SLA" },
                ],
                strengths: [
                  "SOC2 Type II und DSGVO-konform für EU-Einsatz.",
                  "Unbegrenzte Workspaces und Lizenzen inklusive.",
                  "REST API plus Webhooks für alle Aktionen.",
                  "Dedizierter 24/7 Enterprise-Support mit SLA.",
                ],
                weaknesses: [
                  "Steile Lernkurve bei Multi-Step-Workflows.",
                  "Onboarding dauert zwei bis vier Wochen typisch.",
                  "Keine native Mobile-App für iOS oder Android.",
                  "Preis für KMU schwer zu rechtfertigen leider.",
                ],
                footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/enterprise" },
              },
              end: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/enterprise" },
              locale: "de",
            },
            theme,
            brandTokens: DEFAULT_BRAND as Record<string, unknown>,
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
