/**
 * Spec 65.8 — story-arc-clickbait inline end slide.
 *
 * Used as the legacy fallback when no `endSlideData` is set (Spec 65.10
 * `RenderEndSlide` for Family-A is composition-coupled; Family-B keeps its
 * own minimal inline end slide). Renders the `editorial` variant — a clean
 * split-layout with brand-accent surface for the CTA copy.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type { FamilyBEndContent, FamilyBImage } from "../../_shared/family-b/types.ts";

interface InlineEndSlideProps {
  end: FamilyBEndContent;
  image: FamilyBImage | null;
  brandTokens?: unknown;
  theme: "dark" | "light";
  slideIndex: number;
  slideTotal: number;
}

export const InlineEndSlide: React.FC<InlineEndSlideProps> = ({
  end,
  image,
  brandTokens,
  theme,
  slideIndex,
  slideTotal,
}) => {
  const tokens = useMemo(
    () => deriveEmotionalDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  return (
    <SlideComposition variant="editorial" image={image} tokens={tokens}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
          maxWidth: tokens.layout.maxTextWidth,
        }}
      >
        <span
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 600,
            fontSize: 22,
            letterSpacing: tokens.typography.eyebrowLetterSpacing,
            textTransform: "uppercase",
            color: tokens.accent[500],
          }}
        >
          {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
        </span>
        <h2
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 800,
            fontSize: 72,
            lineHeight: 1.05,
            margin: 0,
            color: image ? "#FFFFFF" : tokens.ink.base,
          }}
        >
          <span>{end.headlineLead} </span>
          <em
            style={{
              fontStyle: "normal",
              color: tokens.brand[500],
              fontWeight: 800,
            }}
          >
            {end.headlineEm}
          </em>
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 500,
              fontSize: 28,
              color: image ? "rgba(255,255,255,0.92)" : tokens.ink.muted,
            }}
          >
            {end.ctaLine}
          </span>
          <span
            style={{
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 24,
              color: image ? "#FFFFFF" : tokens.ink.base,
            }}
          >
            {end.articleUrl}
          </span>
        </div>
      </div>
    </SlideComposition>
  );
};
