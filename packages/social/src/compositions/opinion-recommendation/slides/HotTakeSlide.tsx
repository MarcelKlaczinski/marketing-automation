/**
 * Spec 65.8 — opinion-recommendation Hot-Take slide.
 *
 * `editorial` variant (split-layout — image top, bold-statement text bottom).
 * Hot-Take is rendered LARGER than narrative beats in story-arc/lifestyle
 * (64px vs 46px) since it's the centerpiece of the opinion piece.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type { FamilyBImage, FamilyBNarrativeBeat } from "../../_shared/family-b/types.ts";

interface HotTakeSlideProps {
  beat: FamilyBNarrativeBeat;
  image: FamilyBImage | null;
  brandTokens?: unknown;
  theme: "dark" | "light";
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
}

export const HotTakeSlide: React.FC<HotTakeSlideProps> = ({
  beat,
  image,
  brandTokens,
  theme,
  locale,
  slideIndex,
  slideTotal,
}) => {
  const tokens = useMemo(
    () => deriveEmotionalDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );
  const eyebrowLabel = locale === "de" ? "Hot-Take" : "Hot take";

  return (
    <SlideComposition variant="editorial" image={image} tokens={tokens}>
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
            fontSize: 22,
            letterSpacing: tokens.typography.eyebrowLetterSpacing,
            textTransform: "uppercase",
            color: tokens.accent[500],
          }}
        >
          {beat.eyebrow ?? eyebrowLabel} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
        </span>
        {/* Larger font than narrative beats — Hot-Take is the centerpiece. */}
        <p
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 700,
            fontSize: 64,
            lineHeight: 1.12,
            margin: 0,
            color: image ? "#FFFFFF" : tokens.ink.base,
          }}
        >
          {beat.text}
        </p>
      </div>
    </SlideComposition>
  );
};
