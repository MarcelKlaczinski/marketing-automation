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
import { ComparisonGrid5 } from "./compositions/comparison-grid-5/ComparisonGrid5.tsx";
import { comparisonGrid5InputSchema } from "./compositions/comparison-grid-5/types.ts";
import { HeadToHeadVs } from "./compositions/head-to-head-vs/HeadToHeadVs.tsx";
import { headToHeadVsInputSchema } from "./compositions/head-to-head-vs/types.ts";
import { HeadToHeadDeepDive } from "./compositions/head-to-head-deep-dive/HeadToHeadDeepDive.tsx";
import { headToHeadDeepDiveInputSchema } from "./compositions/head-to-head-deep-dive/types.ts";
import { StoryArcClickbait } from "./compositions/story-arc-clickbait/StoryArcClickbait.tsx";
import { storyArcClickbaitInputSchema } from "./compositions/story-arc-clickbait/types.ts";

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
          slideTotal: 7,
          theme: "dark",
          locale: "de",
          cover: {
            eyebrow: "Vergleich · 3 KI-Bild-Generatoren",
            headlineLead: "Die 3 besten",
            headlineEm: "KI-Bild-Generatoren",
            subline: "Drei Tools im Direktvergleich — Pros, Cons, Pricing und der Sieger pro Use-Case.",
            headerNum: "05/2026 · toolwiki.ai/bilder",
          },
          compareHeader: {
            title: "KI-Bild-Generatoren: Was wir vergleichen.",
            criteria: ["Ergebnis-Qualität", "Pricing & Limits", "Workflow-Fit"],
            categoryBadge: "KI-Bild-Generatoren",
          },
          tools: [
            { slug: "midjourney", name: "Midjourney v7", score: 92, scoreTier: "hi", meta: "Premium-Ästhetik · web + Discord", pricePrefix: "Ab", priceAmount: "10 $/Mo", pros: ["Hero-Visuals out-of-the-box", "--sref für Marken-Konsistenz"], cons: ["Schwer aus MJ-Look auszubrechen", "Text im Bild bleibt schwach"], isWinner: true, winnerFlagText: "Top Aesthetic", iconInitials: "MJ", iconHue: 220 },
            { slug: "dalle", name: "DALL·E 4", score: 81, scoreTier: "hi", meta: "Prompt-Adhärenz · via ChatGPT", pricePrefix: "Ab", priceAmount: "20 $/Mo", pros: ["Liefert exakt was du beschreibst", "Text endlich lesbar"], cons: ["Stil oft glatt", "Weniger Stil-Kontrolle"], isWinner: false, iconInitials: "DE", iconHue: 160 },
            { slug: "stable-diffusion", name: "Stable Diffusion", score: 74, scoreTier: "mid", meta: "Maximale Kontrolle · ComfyUI", pricePrefix: "", priceAmount: "Kostenlos", pros: ["LoRAs für 98% Konsistenz", "Kein Abo, keine Quota"], cons: ["Steile Lernkurve", "Default wirkt blass ohne LoRA"], isWinner: false, iconInitials: "SD", iconHue: 270 },
          ],
          verdict: {
            winnerToolSlug: "midjourney",
            reasoning: "Beste Wahl für KI-Bild-Generatoren: Midjourney v7 — die runde Mischung aus Ergebnis-Qualität und Pricing.",
            eyebrow: "Fazit · Sieger",
            ctaLine: "Vollständiger Vergleich →",
          },
          end: {
            headlineLead: "Mehr Vergleiche",
            headlineEm: "ehrlich getestet.",
            articleUrl: "toolwiki.ai/bilder",
            ctaLine: "Vollständiger Vergleich →",
          },
        })}
      />
      <Composition
        id="comparison-grid-5"
        component={ComparisonGrid5}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={comparisonGrid5InputSchema}
        defaultProps={comparisonGrid5InputSchema.parse({
          slideIndex: 0,
          slideTotal: 9,
          theme: "dark",
          locale: "de",
          cover: {
            eyebrow: "Vergleich · 5 KI-Bild-Generatoren",
            headlineLead: "Die 5 besten",
            headlineEm: "KI-Bild-Generatoren",
            subline: "Fünf Tools im Direktvergleich — Pros, Cons, Pricing und der Sieger pro Use-Case.",
            headerNum: "05/2026 · toolwiki.ai/bilder",
          },
          compareHeader: {
            title: "KI-Bild-Generatoren: Was wir vergleichen.",
            criteria: ["Ergebnis-Qualität", "Pricing & Limits", "Workflow-Fit"],
            categoryBadge: "KI-Bild-Generatoren",
          },
          tools: [
            { slug: "midjourney", name: "Midjourney v7", score: 92, scoreTier: "hi", meta: "Premium-Ästhetik", pricePrefix: "Ab", priceAmount: "10 $/Mo", pros: ["Hero-Visuals out-of-the-box", "--sref für Konsistenz"], cons: ["Schwer aus MJ-Look", "Text im Bild schwach"], isWinner: true, winnerFlagText: "Top", iconInitials: "MJ", iconHue: 220 },
            { slug: "dalle", name: "DALL·E 4", score: 84, scoreTier: "hi", meta: "Prompt-Adhärenz", pricePrefix: "Ab", priceAmount: "20 $/Mo", pros: ["Liefert exakt was du beschreibst", "Text lesbar"], cons: ["Stil glatt", "Weniger Stil-Kontrolle"], isWinner: false, iconInitials: "DE", iconHue: 160 },
            { slug: "flux", name: "Flux 1.1 Pro", score: 81, scoreTier: "hi", meta: "Foto-Realismus · API", pricePrefix: "Ab", priceAmount: "5 $/Mo", pros: ["Photo-Look-and-Feel", "Schnell + günstig per API"], cons: ["Style-Transfer schwach", "EN-Prompts bevorzugt"], isWinner: false, iconInitials: "FL", iconHue: 30 },
            { slug: "ideogram", name: "Ideogram 2.0", score: 78, scoreTier: "mid", meta: "Typografie · Web", pricePrefix: "Ab", priceAmount: "8 $/Mo", pros: ["Beste Text-im-Bild", "Schnelle Iteration"], cons: ["Foto-Look weniger natürlich", "Begrenzte Style-Library"], isWinner: false, iconInitials: "ID", iconHue: 290 },
            { slug: "stable-diffusion", name: "Stable Diffusion", score: 74, scoreTier: "mid", meta: "Maximale Kontrolle", pricePrefix: "", priceAmount: "Kostenlos", pros: ["LoRAs für Konsistenz", "Kein Abo, lokal"], cons: ["Steile Lernkurve", "Default wirkt blass"], isWinner: false, iconInitials: "SD", iconHue: 270 },
          ],
          verdict: {
            winnerToolSlug: "midjourney",
            reasoning: "Beste Wahl für KI-Bild-Generatoren: Midjourney v7 — die runde Mischung aus Ergebnis-Qualität und Pricing.",
            eyebrow: "Fazit · Sieger",
            ctaLine: "Vollständiger Vergleich →",
          },
          end: {
            headlineLead: "Mehr Vergleiche",
            headlineEm: "ehrlich getestet.",
            articleUrl: "toolwiki.ai/bilder",
            ctaLine: "Vollständiger Vergleich →",
          },
        })}
      />
      <Composition
        id="head-to-head-vs"
        component={HeadToHeadVs}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={headToHeadVsInputSchema}
        defaultProps={headToHeadVsInputSchema.parse({
          slideIndex: 0,
          slideTotal: 6,
          theme: "dark",
          locale: "de",
          cover: {
            eyebrow: "Head-to-Head · Direktvergleich",
            headlineLead: "Cursor",
            headlineEm: "vs. GitHub Copilot",
            subline: "Welches Tool gewinnt für deinen Workflow? Direktvergleich mit drei Kriterien und Sieger.",
            headerNum: "05/2026 · toolwiki.ai/code-editors",
          },
          tools: [
            { slug: "cursor", name: "Cursor", score: 90, scoreTier: "hi", meta: "AI-First IDE · VS-Code-Fork", pricePrefix: "Ab", priceAmount: "20 $/Mo", pros: ["Composer für Multi-File-Refactors", "Tab-Completion mit Codebase-Kontext"], cons: ["Höhere Latenz inline", "Eigene IDE — Migration"], isWinner: true, iconInitials: "CR", iconHue: 200 },
            { slug: "github-copilot", name: "GitHub Copilot", score: 84, scoreTier: "hi", meta: "Inline-Autocomplete · VS-Code-Plugin", pricePrefix: "Ab", priceAmount: "10 $/Mo", pros: ["Native VS-Code-Integration", "Copilot Chat im Editor"], cons: ["Begrenzter Multi-File-Kontext", "Composer fehlt"], isWinner: false, iconInitials: "GC", iconHue: 30 },
          ],
          compare: {
            criteria: [
              { label: "Multi-File", toolAVerdict: "Composer ist State-of-the-Art", toolBVerdict: "Begrenzt auf offene Tabs", winner: "a" },
              { label: "Inline-Speed", toolAVerdict: "Etwas träger", toolBVerdict: "Sub-Sekunden-Antworten", winner: "b" },
              { label: "Pricing", toolAVerdict: "20 $/Mo Pro", toolBVerdict: "10 $/Mo Individual", winner: "b" },
            ],
          },
          verdict: {
            winnerToolSlug: "cursor",
            reasoning: "Cursor gewinnt für AI-First-Workflows — Composer macht Multi-File-Refactors zum Heimspiel.",
            eyebrow: "Fazit · Sieger",
            ctaLine: "Vollständiger Vergleich →",
          },
          end: {
            headlineLead: "Mehr Vergleiche",
            headlineEm: "ehrlich getestet.",
            articleUrl: "toolwiki.ai/code-editors",
            ctaLine: "Vollständiger Vergleich →",
          },
        })}
      />
      <Composition
        id="head-to-head-deep-dive"
        component={HeadToHeadDeepDive}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={headToHeadDeepDiveInputSchema}
        defaultProps={headToHeadDeepDiveInputSchema.parse({
          slideIndex: 0,
          slideTotal: 9,
          theme: "dark",
          locale: "de",
          cover: {
            eyebrow: "Head-to-Head · Deep Dive",
            headlineLead: "Cursor",
            headlineEm: "vs. GitHub Copilot",
            subline: "Deep Dive: Beide Tools im Detail — Pricing, Use-Cases und ehrliches Fazit.",
            headerNum: "05/2026 · toolwiki.ai/code-editors",
          },
          tools: [
            { slug: "cursor", name: "Cursor", score: 90, scoreTier: "hi", meta: "AI-First IDE", pricePrefix: "Ab", priceAmount: "20 $/Mo", pros: ["Composer für Multi-File-Refactors", "Tab-Completion mit Codebase-Kontext"], cons: ["Höhere Latenz inline", "Eigene IDE"], isWinner: true, iconInitials: "CR", iconHue: 200, extendedPros: ["Inline-Edits im Cursor", "Diff-Preview vor Annahme", "Local-Codebase RAG"], extendedCons: ["Pro-Tier teurer", "Aggressive Suggestions"] },
            { slug: "github-copilot", name: "GitHub Copilot", score: 84, scoreTier: "hi", meta: "Inline-Autocomplete", pricePrefix: "Ab", priceAmount: "10 $/Mo", pros: ["Native VS-Code-Integration", "Copilot Chat"], cons: ["Begrenzter Multi-File-Kontext", "Composer fehlt"], isWinner: false, iconInitials: "GC", iconHue: 30, extendedPros: ["GitHub-Enterprise nativ", "Sicherheitsfilter", "Günstigster Pro-Tier"], extendedCons: ["Kein Composer-Modus", "Kontext auf Tabs begrenzt"] },
          ],
          pricing: {
            title: "Pricing & Limits",
            rows: [
              { label: "Plan", toolA: "Cursor Pro", toolB: "Copilot Individual" },
              { label: "Kosten", toolA: "20 $/Mo", toolB: "10 $/Mo" },
              { label: "Ideal für", toolA: "AI-First Teams", toolB: "VS-Code-Power-User" },
            ],
          },
          useCases: {
            title: "Beste Wahl pro Use-Case",
            rows: [
              { label: "Multi-File-Refactor", winner: "a", reason: "Composer-Modus" },
              { label: "Inline-Completion", winner: "b", reason: "Niedrigere Latenz" },
              { label: "Enterprise-Setup", winner: "b", reason: "GitHub-Integration" },
            ],
          },
          verdict: {
            winnerToolSlug: "cursor",
            reasoning: "Cursor gewinnt für AI-First-Workflows — Composer und Codebase-RAG sind die Killer-Features.",
            eyebrow: "Fazit · Sieger",
            ctaLine: "Vollständiger Vergleich →",
          },
          end: {
            headlineLead: "Mehr Vergleiche",
            headlineEm: "ehrlich getestet.",
            articleUrl: "toolwiki.ai/code-editors",
            ctaLine: "Vollständiger Vergleich →",
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
          generated: {
            toolName: "Midjourney v7",
            toolCategory: "KI-Bildgenerator",
            iconInitials: "MJ",
            iconHue: 260,
            subline: "In Pro und Contra — wofür sich Midjourney lohnt, und wo du besser ein anderes Tool wählst.",
            eyebrow: "Pro & Contra · Tool-Verdict",
            slideNum: "05 / 05",
            ctaLine1: "Vollständiger Test →",
            ctaLine2: "toolwiki.ai/midjourney",
            dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
            prosHeader: "Stärken",
            consHeader: "Schwächen",
            pros: [
              "Beste Ästhetik out-of-the-box",
              "Konsistenz durch --sref & --cref",
              "Schnelle Iteration im Web-Interface",
              "Starke Community & Ressourcen",
            ],
            cons: [
              "Kein API für Automatisierung",
              "Text im Bild schwach",
              "Schwer aus dem MJ-Look auszubrechen",
              "Kein lokales Hosting möglich",
            ],
            verdictText: "Für Hero-Visuals und Branding erste Wahl — solange du keinen API-Zugang brauchst.",
            verdictEm: "erste Wahl",
            recommendationTag: "Empfohlen für: Content Creator & Agenturen",
          },
        })}
      />
      <Composition
        id="story-arc-clickbait"
        component={StoryArcClickbait}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={storyArcClickbaitInputSchema}
        defaultProps={storyArcClickbaitInputSchema.parse({
          slideIndex: 0,
          slideTotal: 7,
          theme: "dark",
          locale: "de",
          hook: {
            rendered: "Wie ich als Texter meinen Job mit KI gerettet habe",
            variables: { profession: "Texter", lifeArea: "Job" },
          },
          narrative: {
            setup: {
              beatName: "setup",
              eyebrow: "Setup",
              text: "Als Texter saß ich jeden Tag vor dem leeren Dokument — bis das Thema KI in jedem Briefing landete.",
            },
            conflict: {
              beatName: "conflict",
              eyebrow: "Konflikt",
              text: "Plötzlich konnte ich die ChatGPT-Texte nicht mehr von meinen unterscheiden. Mein USP fiel weg.",
            },
            resolution: {
              beatName: "resolution",
              eyebrow: "Auflösung",
              text: "Ich entschied mich, KI nicht als Konkurrenz, sondern als Sparring-Partner zu nutzen — und mein Texter-Workflow änderte sich.",
            },
            payoff: {
              beatName: "payoff",
              eyebrow: "Auswirkung",
              text: "Heute spare ich pro Briefing 2 Stunden — und meine Texte sind besser, nicht schlechter geworden.",
            },
            lesson: {
              beatName: "lesson",
              eyebrow: "Lehre",
              text: "Wenn dein Job nicht mehr nur deinen Beruf braucht, sondern dein Urteilsvermögen — bist du genau richtig im KI-Zeitalter.",
            },
          },
          end: {
            headlineLead: "Mehr Geschichten",
            headlineEm: "ehrlich erzählt.",
            articleUrl: "toolwiki.ai/wie-texter-ki",
            ctaLine: "Vollständige Story →",
          },
          images: [],
        })}
      />
    </>
  );
}

registerRoot(RemotionRoot);
