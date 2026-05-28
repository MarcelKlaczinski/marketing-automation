/**
 * Spec 65.8 — opinion-recommendation carousel dispatcher.
 *
 * 6-slide anatomy (spec §3.2):
 *   0 — Cover (hook from pickHook+renderHook; `cover` variant)
 *   1 — Hot-Take (`editorial` variant with image — bold-statement)
 *   2 — Reasoning #1 (`immersive` gradient-only — analytical text)
 *   3 — Reasoning #2 (`immersive` gradient-only — analytical text)
 *   4 — Top-Pick (`product-context` with image + recommended-tool chip)
 *   5 — End (HostSlide opt-in via endSlideData OR InlineEndSlide)
 */
import type React from "react";
import "./loadFonts.ts"; // Side-effect: registers Inter Variable with Remotion
import { RenderEndSlide } from "../_shared/family-b/RenderEndSlide.tsx";
import type { FamilyBImage } from "../_shared/family-b/types.ts";
import { CoverSlide } from "./slides/CoverSlide.tsx";
import { HotTakeSlide } from "./slides/HotTakeSlide.tsx";
import { InlineEndSlide } from "./slides/InlineEndSlide.tsx";
import { ReasoningSlide } from "./slides/ReasoningSlide.tsx";
import { TopPickSlide } from "./slides/TopPickSlide.tsx";
import type { OpinionRecommendationInput } from "./types.ts";

function findImageForSlide(
  images: ReadonlyArray<FamilyBImage>,
  slideIndex: number,
): FamilyBImage | null {
  return images.find((img) => img.slideIndex === slideIndex) ?? null;
}

export const OpinionRecommendation: React.FC<OpinionRecommendationInput> = (props) => {
  const {
    slideIndex,
    slideTotal,
    hook,
    narrative,
    recommendedTool,
    end,
    images,
    brandTokens,
    theme,
    locale,
    endSlideData,
    logoUrl,
    preset,
  } = props;
  const image = findImageForSlide(images, slideIndex);

  // Slide 0 — Cover
  if (slideIndex === 0) {
    return (
      <CoverSlide
        hook={hook}
        image={image}
        brandTokens={brandTokens}
        theme={theme}
        locale={locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(logoUrl !== undefined && { logoUrl })}
        {...(preset !== undefined && { preset })}
      />
    );
  }

  // Slide 1 — Hot-Take
  if (slideIndex === 1) {
    return (
      <HotTakeSlide
        beat={narrative.hotTake}
        image={image}
        brandTokens={brandTokens}
        theme={theme}
        locale={locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(preset !== undefined && { preset })}
      />
    );
  }

  // Slides 2-3 — Reasoning #1 / #2
  if (slideIndex === 2 || slideIndex === 3) {
    const reasoningNumber = slideIndex - 1;
    const beat = slideIndex === 2 ? narrative.reasoning1 : narrative.reasoning2;
    return (
      <ReasoningSlide
        beat={beat}
        reasoningNumber={reasoningNumber}
        brandTokens={brandTokens}
        theme={theme}
        locale={locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(preset !== undefined && { preset })}
      />
    );
  }

  // Slide 4 — Top-Pick
  if (slideIndex === 4) {
    return (
      <TopPickSlide
        beat={narrative.topPick}
        image={image}
        recommendedTool={recommendedTool}
        brandTokens={brandTokens}
        theme={theme}
        locale={locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(preset !== undefined && { preset })}
      />
    );
  }

  // Slide 5 — End
  return (
    <RenderEndSlide
      endSlideData={endSlideData}
      inlineEnd={end}
      inlineImage={image}
      InlineEndSlide={InlineEndSlide}
      brandTokens={brandTokens}
      theme={theme}
      locale={locale}
      slideIndex={slideIndex}
      slideTotal={slideTotal}
      {...(logoUrl !== undefined && { logoUrl })}
      {...(preset !== undefined && { preset })}
    />
  );
};
