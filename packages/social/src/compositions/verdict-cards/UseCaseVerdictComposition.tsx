import React from "react";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import type { UseCaseVerdictInput } from "./types.ts";
import { UseCaseVerdictCoverSlide } from "./UseCaseVerdictCoverSlide.tsx";
import { UseCaseVerdictSlide } from "./UseCaseVerdictSlide.tsx";
import { UseCaseVerdictRecapSlide } from "./UseCaseVerdictRecapSlide.tsx";
import { EndSlideStunning } from "../list-carousel/EndSlideStunning.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { listCarouselInputSchema } from "../list-carousel/types.ts";

const { fontFamily: spaceGroteskFamily } = loadFont();

// Remotion passes the parsed schema fields as flat props — same pattern as ListCarouselStunning
type Props = UseCaseVerdictInput;

export function UseCaseVerdictComposition(props: Props) {
  const { slideIndex, verdicts } = props;
  const totalSlides = 1 + verdicts.length + 2;
  const theme = getThemeTokens(undefined, props.theme);

  if (slideIndex === 0) {
    return <UseCaseVerdictCoverSlide input={props} totalSlides={totalSlides} />;
  }

  if (slideIndex >= 1 && slideIndex <= verdicts.length) {
    const verdict = verdicts[slideIndex - 1]!;
    return (
      <UseCaseVerdictSlide
        input={props}
        verdict={verdict}
        verdictIndex={slideIndex}
        slideIndex={slideIndex}
        totalSlides={totalSlides}
      />
    );
  }

  if (slideIndex === verdicts.length + 1) {
    return (
      <UseCaseVerdictRecapSlide
        input={props}
        slideIndex={slideIndex}
        totalSlides={totalSlides}
      />
    );
  }

  // End slide — reuse EndSlideStunning with a bridged ListCarouselInput.
  // listCarouselInputSchema requires tools.min(3) and strengths.min(2); the end slide only
  // uses slug/name/icon fields — strengths and extra padding tools never render (filtered by toolRecap).
  const brandTokensWithFont = listCarouselInputSchema.shape.brandTokens.parse({
    typography: { fontFamily: spaceGroteskFamily },
  });

  const mappedTools = props.tools.map((t, i) => ({
    slug: t.slug,
    rank: i + 1,
    name: t.name,
    domain: `${t.slug}.com`,
    eyebrow: "",
    tagline: "",
    strengths: ["", ""] as [string, string], // min(2) satisfied; end slide doesn't display strengths
    pricing: { tier: "freemium" as const, label: "" },
    ...(t.iconSvg !== undefined && { iconSvg: t.iconSvg }),
    ...(t.iconInitials !== undefined && { iconInitials: t.iconInitials }),
    ...(t.iconHue !== undefined && { iconHue: t.iconHue }),
  }));
  // Pad to min(3) — dummy entries are excluded by toolRecap filter in EndSlideStunning
  while (mappedTools.length < 3) {
    mappedTools.push({
      slug: `_pad${mappedTools.length}`,
      rank: mappedTools.length + 1,
      name: "",
      domain: "",
      eyebrow: "",
      tagline: "",
      strengths: ["", ""] as [string, string],
      pricing: { tier: "freemium" as const, label: "" },
    });
  }

  const endInput = listCarouselInputSchema.parse({
    theme: props.theme,
    variant: "stunning",
    brandTokens: brandTokensWithFont,
    slideIndex,
    cover: {
      eyebrow: "",
      headlineLead: "",
      headlineHighlight: "",
    },
    tools: mappedTools,
    end: {
      headline: props.locale === "de" ? "Mehr Reviews," : "More reviews,",
      headlineHighlight: props.locale === "de" ? "ehrlich getestet." : "honestly tested.",
      articleUrl: `${props.websiteUrl}/${props.articleSlug}`,
      toolRecap: props.tools.map((t) => t.slug),
      closer: {
        pattern: "action_frame" as const,
        line1: {
          leadText: props.locale === "de" ? "Speichere" : "Save",
          highlightText: props.locale === "de" ? "diesen Post" : "this post",
          trailText: ".",
        },
        line2: {
          leadText: props.locale === "de" ? "Für wenn du" : "For when you",
          highlightText: props.locale === "de" ? "entscheidest" : "decide",
          trailText: ".",
        },
        fullText: "",
      },
    },
  });

  return <EndSlideStunning input={endInput} theme={theme} totalSlides={totalSlides} />;
}
