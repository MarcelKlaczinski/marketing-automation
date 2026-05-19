import { Composition, registerRoot } from "remotion";
import { ListCarouselStunning } from "./compositions/list-carousel/ListCarouselStunning.tsx";
import { listCarouselInputSchema } from "./compositions/list-carousel/types.ts";
import { VerdictPerUseCase } from "./compositions/verdict-per-use-case/VerdictPerUseCase.tsx";
import { verdictPerUseCaseInputSchema } from "./compositions/verdict-per-use-case/types.ts";
import { SingleToolSpotlight } from "./compositions/single-tool-spotlight/SingleToolSpotlight.tsx";
import { singleToolSpotlightInputSchema } from "./compositions/single-tool-spotlight/types.ts";
import { ProConVerdictComposition } from "./compositions/pro-con-verdict/ProConVerdict.tsx";
import { proConVerdictInputSchema } from "./compositions/pro-con-verdict/types.ts";
import { ComparisonGrid4 } from "./compositions/comparison-grid-4/ComparisonGrid4.tsx";
import { comparisonGrid4InputSchema } from "./compositions/comparison-grid-4/types.ts";
import { ComparisonGrid3 } from "./compositions/comparison-grid-3/ComparisonGrid3.tsx";
import { comparisonGrid3InputSchema } from "./compositions/comparison-grid-3/types.ts";

const stunningDefaultProps = listCarouselInputSchema.parse({
  theme: "dark",
  variant: "stunning",
  cover: {
    eyebrow: "KI-BILD-GENERATOREN · 2026",
    headlineLead: "Die 5 besten",
    headlineHighlight: "KI-Bild-Generatoren",
    hookOutput: {
      pattern: "number_promise",
      leadPhrase: "Die 5 besten",
      highlightWord: "KI-Bild-Tools",
      trailPhrase: "im Vergleich.",
      fullText: "Die 5 besten KI-Bild-Tools im Vergleich.",
      promiseBlock: {
        line1: "Alle 5 in der Praxis getestet.",
        line2: "Ehrlich verglichen.",
      },
    },
  },
  tools: [
    {
      slug: "midjourney",
      rank: 1,
      name: "Midjourney",
      domain: "midjourney.com",
      eyebrow: "01 · KI-BILD-GENERATOR",
      tagline: "Beste Wahl für kreative, künstlerisch anspruchsvolle Bildgenerierung.",
      strengths: ["Beste Bildqualität", "Aktive Community", "Regelmäßige Updates"],
      pricing: { tier: "paid", label: "ab 10€/Monat" },
      starStrength: "Beste Bildqualität",
      keyDifferentiator: "künstlerisch anspruchsvolle",
    },
    {
      slug: "dalle",
      rank: 2,
      name: "DALL-E 3",
      domain: "openai.com",
      eyebrow: "02 · KI-BILD-GENERATOR",
      tagline: "Stärkste Textverständnis-Integration aller Modelle.",
      strengths: ["Präzise Textbefolgung", "ChatGPT-Integration", "API-Zugang"],
      pricing: { tier: "freemium", label: "ab 0€" },
      starStrength: "Präzise Textbefolgung",
      keyDifferentiator: "Textverständnis-Integration",
    },
    {
      slug: "adobe-firefly",
      rank: 3,
      name: "Adobe Firefly",
      domain: "firefly.adobe.com",
      eyebrow: "03 · KI-BILD-GENERATOR",
      tagline: "Kommerziell sicher — alle Bilder ohne Lizenzrisiko nutzbar.",
      strengths: ["Lizenzfrei nutzbar", "Adobe-Integration", "Generative Fill"],
      pricing: { tier: "freemium", label: "ab 0€" },
      starStrength: "Lizenzfrei nutzbar",
      keyDifferentiator: "ohne Lizenzrisiko",
    },
  ],
  end: {
    headline: "Mehr Reviews,",
    headlineHighlight: "ehrlich getestet.",
    articleUrl: "toolwiki.ai/ki-bild-generatoren",
    closer: {
      pattern: "action_frame",
      line1: { leadText: "3 Tools", highlightText: "getestet", trailText: "." },
      line2: { leadText: "Speichere für", highlightText: "später", trailText: "." },
      fullText: "3 Tools getestet. Speichere für später.",
    },
    toolRecap: ["midjourney", "dalle", "adobe-firefly"],
  },
});

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="ComparisonGrid"
        component={ListCarouselStunning}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={listCarouselInputSchema}
        defaultProps={stunningDefaultProps}
      />
      <Composition
        id="verdict-per-use-case"
        component={VerdictPerUseCase}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={verdictPerUseCaseInputSchema}
        defaultProps={verdictPerUseCaseInputSchema.parse({
          theme: "dark",
          locale: "de",
          slideIndex: 0,
          generated: {
            headline: "Ein Tool reicht",
            headlineEm: "nicht mehr.",
            subline: "7 Use Cases. 7 klare Empfehlungen. Keine Kompromisse.",
            eyebrow: "Bestes Tool für …",
            slideNum: "03 / 04",
            ctaLine1: "Vollständige Matrix →",
            ctaLine2: "toolwiki.ai/ki-bilder",
            dateLabel: "7 Use Cases · KI-Bildgenerierung 2026",
            useCases: [
              { label: "Marketing-Visuals", winnerName: "Midjourney v7", iconInitials: "MJ", iconHue: 260 },
              { label: "Photoshop-Workflow", winnerName: "Adobe Firefly 3", iconInitials: "FF", iconHue: 20 },
              { label: "Produktfotos", winnerName: "Flux 1.2 Pro", iconInitials: "FL", iconHue: 200 },
              { label: "Typografie & Logos", winnerName: "Ideogram v3", iconInitials: "ID", iconHue: 300 },
              { label: "Konsistente Chars", winnerName: "SD + LoRA", iconInitials: "SD", iconHue: 160 },
            ],
          },
        })}
      />
      <Composition
        id="SingleToolSpotlight"
        component={SingleToolSpotlight}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={singleToolSpotlightInputSchema}
        defaultProps={singleToolSpotlightInputSchema.parse({
          slideIndex: 1,
          slideTotal: 3,
          cover: null,
          body: {
            eyebrow: "Deep Dive · Tool-Portrait",
            headerNum: "Test 04/2026 · 50k+ Generierungen",
            slideIndex: 1,
            slideTotal: 3,
            tool: {
              logo: "",
              name: "Midjourney",
              version: "v7 · Premium-Ästhetik",
              isLive: true,
            },
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
            ],
            weaknesses: [
              "Text im Bild bleibt schwach (→ Ideogram).",
              "Schwer aus dem MJ-Look auszubrechen.",
              "--cref max. 85 % Charakter-Ähnlichkeit.",
            ],
            footer: {
              ctaLine: "Vollständiger Test →",
              url: "toolwiki.ai/midjourney",
            },
          },
          end: {
            ctaLine: "Vollständiger Test →",
            url: "toolwiki.ai/midjourney",
          },
        })}
      />
      <Composition
        id="comparison-grid-4"
        component={ComparisonGrid4}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={comparisonGrid4InputSchema}
        defaultProps={comparisonGrid4InputSchema.parse({
          slideIndex: 0,
          locale: "de",
          theme: "dark",
          generated: {
            headline: "Welcher KI-Bildgenerator",
            headlineEm: "gewinnt 2026?",
            subline: "Vier Modelle, dieselben 12 Prompts, drei Wochen Test. Hier ist das Ergebnis.",
            eyebrow: "Vergleich · 4 Bildgeneratoren",
            slideNum: "01 / 04",
            ctaLine1: "Vollständiger Test →",
            ctaLine2: "toolwiki.ai/bilder",
            dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
            tools: [
              { name: "Midjourney", verdictStrong: "Beste Ästhetik out-of-the-box", verdictRest: ", unschlagbar für Hero-Visuals.", score: 92, scoreTier: "hi", priceLabel: "v7 · 30 $/Mo", isWinner: true, winnerFlagText: "Testsieger", iconInitials: "MJ", iconHue: 220 },
              { name: "Flux 1.2 Pro", verdictStrong: "Fotorealismus & korrekte Hände", verdictRest: ", mit selbst-hostbarem Dev-Modell.", score: 88, scoreTier: "hi", priceLabel: "API · ab 0.05 $/Bild", isWinner: false, iconInitials: "FL", iconHue: 180 },
              { name: "DALL·E 4", verdictStrong: "Höchste Prompt-Adhärenz", verdictRest: ", in ChatGPT Plus enthalten.", score: 81, scoreTier: "hi", priceLabel: "via ChatGPT · 20 $/Mo", isWinner: false, iconInitials: "DE", iconHue: 160 },
              { name: "Stable Diffusion", verdictStrong: "Maximale Kontrolle", verdictRest: " über ComfyUI & LoRAs.", score: 74, scoreTier: "mid", priceLabel: "Open-Source · lokal", isWinner: false, iconInitials: "SD", iconHue: 270 },
            ],
          },
        })}
      />
      <Composition
        id="comparison-grid-3"
        component={ComparisonGrid3}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={comparisonGrid3InputSchema}
        defaultProps={comparisonGrid3InputSchema.parse({
          slideIndex: 0,
          locale: "de",
          theme: "dark",
          generated: {
            headline: "Die",
            headlineEm: "drei Schulen",
            subline: "Ästhetik, Prompt-Adhärenz oder Kontrolle — jedes Tool steht für eine andere Philosophie.",
            eyebrow: "Vergleich · 3 Top-Modelle",
            slideNum: "02 / 04",
            ctaLine1: "Workflow-Empfehlungen →",
            ctaLine2: "toolwiki.ai/bilder",
            dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
            tools: [
              { name: "Midjourney v7", meta: "Premium-Ästhetik · web + Discord", score: 92, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "10 $/Mo", isWinner: true, winnerFlagText: "Top Aesthetic", pros: ["Hero-Visuals out-of-the-box", "--sref für Marken-Konsistenz"], cons: ["Schwer aus MJ-Look auszubrechen", "Text im Bild bleibt schwach"], iconInitials: "MJ", iconHue: 220 },
              { name: "DALL·E 4", meta: "Prompt-Adhärenz · via ChatGPT", score: 81, scoreTier: "hi", pricePrefix: "Ab", priceAmount: "20 $/Mo", isWinner: false, pros: ["Liefert exakt was du beschreibst", "Text endlich lesbar"], cons: ["Stil oft glatt, austauschbar", "Weniger Stil-Kontrolle"], iconInitials: "DE", iconHue: 160 },
              { name: "Stable Diffusion", meta: "Maximale Kontrolle · ComfyUI", score: 74, scoreTier: "mid", pricePrefix: "", priceAmount: "Kostenlos", isWinner: false, pros: ["LoRAs für 98% Charakter-Konsistenz", "Kein Abo, keine Quota"], cons: ["Steile Lernkurve (Hardware + Nodes)", "SD-Default wirkt blass ohne LoRA"], iconInitials: "SD", iconHue: 270 },
            ],
          },
        })}
      />
      <Composition
        id="ProConVerdict"
        component={ProConVerdictComposition}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={proConVerdictInputSchema}
        defaultProps={proConVerdictInputSchema.parse({
          theme: "dark",
          locale: "de",
          slideIndex: 0,
          tool: { name: "Loom" },
          pros: [
            "Async-Video direkt im Browser, kein Schnitt nötig",
            "Auto-Transkription in 50+ Sprachen",
            "Integriert sich in Slack, Notion, Linear",
          ],
          cons: [
            "Free-Tier auf 5 Min/Video begrenzt",
            "Editor schwach für längere Tutorials",
            "Keine echte Live-Recording-Option",
          ],
          verdict: {
            snippet: "Solide für schnelle Async-Updates, schwach für Tutorial-Macher",
            whenToUse: "Wenn du regelmäßig kurze Status-Videos für Teams brauchst. Loom glänzt bei 1-5 Min Clips ohne Schnitt.",
            whenToSkip: "Wenn du längere strukturierte Tutorials produzierst oder Live-Streaming brauchst.",
          },
        })}
      />
    </>
  );
}

registerRoot(RemotionRoot);
