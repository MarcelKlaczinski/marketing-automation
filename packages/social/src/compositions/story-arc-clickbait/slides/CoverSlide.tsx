/**
 * Spec 65.8 — story-arc-clickbait Cover slide.
 *
 * `cover` variant per spec §3.11 Option δ: split-layout (image top 55% +
 * text bottom 45%). When no photographic background is available, the
 * bottom block uses the emotional primary surface so the hook still pops.
 *
 * No LLM at render time — the hook comes from `pickHook` (Spec 65.4) +
 * `renderHook` (variable substitution) at brief-generation time. This
 * keeps Cover cost-free per spec §3.7 cost-breakdown.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type { FamilyBHook, FamilyBImage } from "../../_shared/family-b/types.ts";

interface CoverSlideProps {
  hook: FamilyBHook;
  image: FamilyBImage | null;
  brandTokens?: unknown;
  theme: "dark" | "light";
  slideIndex: number;
  slideTotal: number;
}

export const CoverSlide: React.FC<CoverSlideProps> = ({
  hook,
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
    <SlideComposition variant="cover" image={image} tokens={tokens}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 24,
          maxWidth: tokens.layout.maxTextWidth,
        }}
      >
        <span
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: tokens.typography.eyebrowLetterSpacing,
            textTransform: "uppercase",
            color: tokens.accent[500],
            opacity: 0.95,
          }}
        >
          {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
        </span>
        <h1
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 800,
            fontSize: 80,
            lineHeight: 1.05,
            margin: 0,
            color: image ? "#FFFFFF" : tokens.ink.base,
          }}
        >
          {hook.rendered}
        </h1>
      </div>
    </SlideComposition>
  );
};
