import { Composition, registerRoot } from "remotion";
import { ListCarousel } from "./compositions/list-carousel/ListCarousel.tsx";
import { listCarouselInputSchema } from "./compositions/list-carousel/types.ts";

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
    </>
  );
}

registerRoot(RemotionRoot);
