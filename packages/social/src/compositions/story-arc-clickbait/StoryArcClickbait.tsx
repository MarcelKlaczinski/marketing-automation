/**
 * Spec 65.8 — story-arc-clickbait carousel dispatcher.
 *
 * 7-slide anatomy (spec §3.2):
 *   0 — Cover (hook from pickHook+renderHook; image variant `cover`)
 *   1 — Setup (gradient-only `immersive`)
 *   2 — Conflict (`immersive` with image)
 *   3 — Resolution (`immersive` with image + inline tool mention)
 *   4 — Payoff (`immersive` with image + inline tool mention)
 *   5 — Lesson (gradient-only `immersive`)
 *   6 — End (HostSlide opt-in via endSlideData OR InlineEndSlide)
 *
 * Photographic backgrounds are looked up per-slide-index from `props.images`
 * (populated upstream by the photographic-pipeline orchestrator before
 * render time). Slides without an entry render gradient-only fallback —
 * the `SlideComposition` `image={null}` branch handles it.
 */
import type React from "react";
import "./loadFonts.ts"; // Side-effect: registers Inter Variable with Remotion
import { RenderEndSlide } from "../_shared/family-b/RenderEndSlide.tsx";
import type { FamilyBImage } from "../_shared/family-b/types.ts";
import { CoverSlide } from "./slides/CoverSlide.tsx";
import { InlineEndSlide } from "./slides/InlineEndSlide.tsx";
import { NarrativeSlide } from "./slides/NarrativeSlide.tsx";
import type { StoryArcClickbaitInput } from "./types.ts";

const NARRATIVE_BEAT_BY_INDEX = ["setup", "conflict", "resolution", "payoff", "lesson"] as const;

function findImageForSlide(images: ReadonlyArray<FamilyBImage>, slideIndex: number): FamilyBImage | null {
  return images.find((img) => img.slideIndex === slideIndex) ?? null;
}

export const StoryArcClickbait: React.FC<StoryArcClickbaitInput> = (props) => {
  const { slideIndex, slideTotal, hook, narrative, primaryTool, end, images, brandTokens, theme, locale, endSlideData, logoUrl } = props;
  const image = findImageForSlide(images, slideIndex);

  // Slide 0 — Cover
  if (slideIndex === 0) {
    return (
      <CoverSlide
        hook={hook}
        image={image}
        brandTokens={brandTokens}
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(logoUrl !== undefined && { logoUrl })}
      />
    );
  }

  // Slides 1–5 — Narrative beats
  if (slideIndex >= 1 && slideIndex <= 5) {
    const beatName = NARRATIVE_BEAT_BY_INDEX[slideIndex - 1];
    if (beatName) {
      const beat = narrative[beatName];
      // Tool mention only on Resolution (slide 3) + Payoff (slide 4) per spec §3.2.
      const tool = (slideIndex === 3 || slideIndex === 4) ? (primaryTool ?? null) : null;
      return (
        <NarrativeSlide
          beat={beat}
          image={image}
          tool={tool}
          variant="immersive"
          brandTokens={brandTokens}
          theme={theme}
          slideIndex={slideIndex}
          slideTotal={slideTotal}
        />
      );
    }
  }

  // Slide 6 — End
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
    />
  );
};
