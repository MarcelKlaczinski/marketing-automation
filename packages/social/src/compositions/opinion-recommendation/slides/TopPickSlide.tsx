/**
 * Spec 65.8 — opinion-recommendation Top-Pick slide.
 *
 * `product-context` variant (image at 70% opacity + brand-color overlay)
 * — the tool IS the topic of this slide, so strong product framing is
 * intentional. InlineToolMention chip is rendered PROMINENT below the
 * beat text so the recommendation lands visually as well as in the copy.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { InlineToolMention } from "../../_shared/family-b/InlineToolMention.tsx";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type {
  FamilyBImage,
  FamilyBNarrativeBeat,
  FamilyBToolMention,
} from "../../_shared/family-b/types.ts";

interface TopPickSlideProps {
  beat: FamilyBNarrativeBeat;
  image: FamilyBImage | null;
  recommendedTool: FamilyBToolMention;
  brandTokens?: unknown;
  theme: "dark" | "light";
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
}

export const TopPickSlide: React.FC<TopPickSlideProps> = ({
  beat,
  image,
  recommendedTool,
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
  const eyebrowLabel = locale === "de" ? "Top-Pick" : "Top pick";
  const isOnImage = image !== null;
  const inkColor = isOnImage ? "#FFFFFF" : tokens.ink.base;

  return (
    <SlideComposition variant="product-context" image={image} tokens={tokens}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
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
            color: isOnImage ? "rgba(255,255,255,0.95)" : tokens.accent[500],
          }}
        >
          {beat.eyebrow ?? eyebrowLabel} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
        </span>
        <p
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 500,
            fontSize: 46,
            lineHeight: 1.25,
            margin: 0,
            color: inkColor,
          }}
        >
          {beat.text}
        </p>
        <div style={{ marginTop: 12 }}>
          <InlineToolMention tool={recommendedTool} tokens={tokens} size="prominent" />
        </div>
      </div>
    </SlideComposition>
  );
};
