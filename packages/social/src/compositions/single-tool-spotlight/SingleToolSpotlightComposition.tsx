import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { CoverSlide } from "./CoverSlide.tsx";
import { StrengthsSlide } from "./StrengthsSlide.tsx";
import { PricingForWhomSlide } from "./PricingForWhomSlide.tsx";
import { UseCaseDetailSlide } from "./UseCaseDetailSlide.tsx";
import { EndSlide } from "./EndSlide.tsx";
import type { SingleToolSpotlightInput } from "./types.ts";

loadFont();

export function SingleToolSpotlightComposition(props: SingleToolSpotlightInput) {
  const { slideIndex, tool } = props;
  const hasUseCaseSlide = tool.useCases.length >= 3;
  const totalSlides = hasUseCaseSlide ? 5 : 4;
  const input = { ...props, totalSlides };

  // Slide layout:
  // 0: Cover
  // 1: Strengths
  // 2: Pricing & For-Whom
  // 3 (if hasUseCaseSlide): Use-Case Detail  → End is 4
  // 3 (if !hasUseCaseSlide): End
  const endSlideIndex = hasUseCaseSlide ? 4 : 3;

  if (slideIndex === 0) {
    return <CoverSlide input={input} />;
  }
  if (slideIndex === 1) {
    return <StrengthsSlide input={input} slideNumber={2} />;
  }
  if (slideIndex === 2) {
    return <PricingForWhomSlide input={input} slideNumber={3} />;
  }
  if (hasUseCaseSlide && slideIndex === 3) {
    return <UseCaseDetailSlide input={input} slideNumber={4} />;
  }
  if (slideIndex === endSlideIndex) {
    return <EndSlide input={input} slideNumber={endSlideIndex + 1} />;
  }

  // Fallback — should not occur within valid slide range
  return <CoverSlide input={input} />;
}
