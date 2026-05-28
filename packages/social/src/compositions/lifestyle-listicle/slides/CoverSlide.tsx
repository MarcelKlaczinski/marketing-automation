/**
 * Spec 65.8 — lifestyle-listicle Cover slide.
 *
 * `cover` variant (split-layout, image top / text bottom). No LLM at render
 * time — hook from Spec 65.4 `pickHook` + `renderHook`. Item-count badge
 * shown in eyebrow ("3 lifestyle moments · 01 / 06") so the audience knows
 * what to expect when they swipe.
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
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
  /** Spec 65.15 — bottom-right brand-stamp watermark. */
  logoUrl?: string | null;
}

export const CoverSlide: React.FC<CoverSlideProps> = ({
  hook,
  image,
  brandTokens,
  theme,
  locale,
  slideIndex,
  slideTotal,
  logoUrl,
}) => {
  const tokens = useMemo(
    () => deriveEmotionalDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );
  const itemCountLabel = locale === "de" ? "3 Lifestyle-Momente" : "3 lifestyle moments";

  return (
    <SlideComposition variant="cover" image={image} tokens={tokens} logoUrl={logoUrl}>
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
          {itemCountLabel} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
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
