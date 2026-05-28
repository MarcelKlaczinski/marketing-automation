/**
 * Spec 65.8 — lifestyle-listicle carousel dispatcher.
 *
 * 6-slide anatomy (spec §3.2):
 *   0 — Cover (hook from pickHook+renderHook; `cover` variant)
 *   1 — Intro (gradient-only `immersive` + featured-tool chip)
 *   2 — Item #1 (`product-context` with image + tool chip)
 *   3 — Item #2 (`product-context` with image + tool chip)
 *   4 — Item #3 (`product-context` with image + tool chip)
 *   5 — End (HostSlide opt-in via endSlideData OR InlineEndSlide)
 */
import type React from "react";
import "./loadFonts.ts"; // Side-effect: registers Inter Variable with Remotion
import { RenderEndSlide } from "../_shared/family-b/RenderEndSlide.tsx";
import type { FamilyBImage } from "../_shared/family-b/types.ts";
import { CoverSlide } from "./slides/CoverSlide.tsx";
import { InlineEndSlide } from "./slides/InlineEndSlide.tsx";
import { IntroSlide } from "./slides/IntroSlide.tsx";
import { ItemSlide } from "./slides/ItemSlide.tsx";
import type { LifestyleListicleInput } from "./types.ts";

function findImageForSlide(
  images: ReadonlyArray<FamilyBImage>,
  slideIndex: number,
): FamilyBImage | null {
  return images.find((img) => img.slideIndex === slideIndex) ?? null;
}

export const LifestyleListicle: React.FC<LifestyleListicleInput> = (props) => {
  const {
    slideIndex,
    slideTotal,
    hook,
    narrative,
    featuredTool,
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

  // Slide 1 — Intro (gradient-only)
  if (slideIndex === 1) {
    return (
      <IntroSlide
        beat={narrative.intro}
        featuredTool={featuredTool}
        brandTokens={brandTokens}
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(preset !== undefined && { preset })}
      />
    );
  }

  // Slides 2-4 — Item #1/2/3
  if (slideIndex >= 2 && slideIndex <= 4) {
    const itemKey = slideIndex === 2 ? "item1" : slideIndex === 3 ? "item2" : "item3";
    const itemNumber = slideIndex - 1;
    return (
      <ItemSlide
        beat={narrative[itemKey]}
        itemNumber={itemNumber}
        image={image}
        featuredTool={featuredTool}
        brandTokens={brandTokens}
        theme={theme}
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
