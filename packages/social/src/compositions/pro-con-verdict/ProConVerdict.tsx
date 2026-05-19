import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import type { ProConVerdictInput } from "./types.ts";
import { CoverSlide } from "./CoverSlide.tsx";
import { ProsSlide } from "./ProsSlide.tsx";
import { ConsSlide } from "./ConsSlide.tsx";
import { VerdictSlide } from "./VerdictSlide.tsx";
import { EndSlide } from "./EndSlide.tsx";

loadFont();

export function ProConVerdictComposition(props: ProConVerdictInput) {
  const { slideIndex, overrides } = props;

  // overrides arrives as Record<string,unknown> from the Zod boundary; structural narrowing needed to read the layout flag.
  const includeEndSlide = (overrides as { layout?: { includeEndSlide?: boolean } } | undefined)?.layout?.includeEndSlide ?? true;
  const totalSlides = includeEndSlide ? 5 : 4;

  if (slideIndex === 0) {
    return <CoverSlide input={props} totalSlides={totalSlides} />;
  }
  if (slideIndex === 1) {
    return <ProsSlide input={props} slideNumber={2} totalSlides={totalSlides} />;
  }
  if (slideIndex === 2) {
    return <ConsSlide input={props} slideNumber={3} totalSlides={totalSlides} />;
  }
  if (slideIndex === 3) {
    return <VerdictSlide input={props} slideNumber={4} totalSlides={totalSlides} />;
  }
  if (includeEndSlide && slideIndex === 4) {
    return <EndSlide input={props} slideNumber={5} totalSlides={totalSlides} />;
  }

  return <CoverSlide input={props} totalSlides={totalSlides} />;
}
