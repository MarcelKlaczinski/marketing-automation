import { Composition, registerRoot } from "remotion";
import { ListCarouselStunning } from "./compositions/list-carousel/ListCarouselStunning.tsx";
import { listCarouselInputSchema } from "./compositions/list-carousel/types.ts";
import { UseCaseVerdictComposition } from "./compositions/verdict-cards/UseCaseVerdictComposition.tsx";
import { useCaseVerdictInputSchema } from "./compositions/verdict-cards/types.ts";
import { SingleToolSpotlight } from "./compositions/single-tool-spotlight/SingleToolSpotlight.tsx";
import { singleToolSpotlightInputSchema } from "./compositions/single-tool-spotlight/types.ts";
import { ProConVerdictComposition } from "./compositions/pro-con-verdict/ProConVerdict.tsx";
import { proConVerdictInputSchema } from "./compositions/pro-con-verdict/types.ts";

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
        id="VerdictPerUseCase"
        component={UseCaseVerdictComposition}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={useCaseVerdictInputSchema}
        defaultProps={useCaseVerdictInputSchema.parse({
          theme: "dark",
          locale: "de",
          slideIndex: 0,
          websiteUrl: "toolwiki.ai",
          instagramHandle: "@toolwiki.ai",
          articleSlug: "recraft-vs-ideogram",
          tools: [
            { slug: "recraft", name: "Recraft", iconInitials: "RC", iconHue: 220 },
            { slug: "ideogram", name: "Ideogram", iconInitials: "ID", iconHue: 280 },
          ],
          verdicts: [
            { useCase: "Logo-Design", winner: "recraft", reason: "Präziser Vektor-Export." },
            { useCase: "Text im Bild", winner: "ideogram", reason: "Lesbarere Schrift." },
            { useCase: "Social Posts", winner: "recraft", reason: "Mehr Templates." },
          ],
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
