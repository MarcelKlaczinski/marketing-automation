import { Composition, registerRoot } from "remotion";
import { ListCarousel } from "./compositions/list-carousel/ListCarousel.tsx";
import { ListCarouselStunning } from "./compositions/list-carousel/ListCarouselStunning.tsx";
import { listCarouselInputSchema } from "./compositions/list-carousel/types.ts";
import { UseCaseVerdictComposition } from "./compositions/use-case-verdict/UseCaseVerdictComposition.tsx";
import { useCaseVerdictInputSchema } from "./compositions/use-case-verdict/types.ts";
import { SingleToolSpotlightComposition } from "./compositions/single-tool-spotlight/SingleToolSpotlightComposition.tsx";
import { singleToolSpotlightInputSchema } from "./compositions/single-tool-spotlight/types.ts";

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
        id="ListCarousel"
        component={ListCarousel}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1080}
        schema={listCarouselInputSchema}
        defaultProps={listCarouselInputSchema.parse({
          theme: "dark",
          cover: {
            eyebrow: "AUSGABE 01 · KI-TOOLS",
            headlineLead: "Die 5 besten",
            headlineHighlight: "KI-Bild-Generatoren",
            headlineTrail: "in 2026.",
            subhead: "redaktionell verifiziert",
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
            },
            {
              slug: "adobe-firefly",
              rank: 3,
              name: "Adobe Firefly",
              domain: "firefly.adobe.com",
              eyebrow: "03 · KI-BILD-GENERATOR",
              tagline: "Kommerziell sicher — alle Bilder ohne Lizenzrisiko.",
              strengths: ["Lizenzfrei nutzbar", "Adobe-Integration", "Generative Fill"],
              pricing: { tier: "freemium", label: "ab 0€" },
            },
          ],
          end: {
            headline: "Mehr Reviews,",
            headlineHighlight: "ehrlich getestet.",
            articleUrl: "toolwiki.ai/ki-bild-generatoren",
          },
        })}
      />
      <Composition
        id="ListCarouselStunning"
        component={ListCarouselStunning}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={listCarouselInputSchema}
        defaultProps={stunningDefaultProps}
      />
      <Composition
        id="UseCaseVerdictCarousel"
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
        component={SingleToolSpotlightComposition}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        schema={singleToolSpotlightInputSchema}
        defaultProps={singleToolSpotlightInputSchema.parse({
          theme: "dark",
          locale: "de",
          slideIndex: 0,
          websiteUrl: "toolwiki.ai",
          instagramHandle: "@toolwiki.ai",
          articleSlug: "synthesia",
          tool: {
            slug: "synthesia",
            name: "Synthesia",
            tagline: "Enterprise-grade KI-Avatarvideos für Training & Marketing.",
            primaryCategory: "KI-Video",
            pricingTier: "paid",
            priceFrom: 22,
            rating: 4.4,
            pros: [
              { text: "Enterprise-grade Compliance (SOC 2, ISO 27001)" },
              { text: "Keine Kamera-Crew nötig" },
              { text: "Training-Videos in 140 Sprachen" },
            ],
            cons: [
              { text: "Lippen-Sync nicht immer perfekt" },
              { text: "Hohe Kosten bei vielen Minuten" },
            ],
            features: ["160+ vorgefertigte Avatare", "140 Sprachen"],
            useCases: ["Corporate Training", "Compliance-Schulungen", "Produktvideos in 140 Sprachen"],
            iconInitials: "SY",
            iconHue: 200,
          },
        })}
      />
    </>
  );
}

registerRoot(RemotionRoot);
