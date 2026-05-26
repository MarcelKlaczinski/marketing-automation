/**
 * Spec 65.8 — lifestyle-listicle Item slide (used for slides 2/3/4).
 *
 * `product-context` variant (image at 70% opacity + brand-color overlay
 * mixed-blend multiply) per spec §3.11 Option α — strong product framing
 * since the item slides ARE the product moment. Big item-number badge
 * (1/2/3) at top-right anchors the listicle rhythm.
 *
 * The Item slide always renders the InlineToolMention chip at the bottom
 * so the tool is visually present even when the photo doesn't show it
 * directly. Gradient-only fallback (no photographic background) is
 * handled by `SlideComposition.product-context` variant.
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

interface ItemSlideProps {
  beat: FamilyBNarrativeBeat;
  /** 1-based item number (1, 2, or 3). */
  itemNumber: number;
  image: FamilyBImage | null;
  featuredTool: FamilyBToolMention;
  brandTokens?: unknown;
  theme: "dark" | "light";
  slideIndex: number;
  slideTotal: number;
}

export const ItemSlide: React.FC<ItemSlideProps> = ({
  beat,
  itemNumber,
  image,
  featuredTool,
  brandTokens,
  theme,
  slideIndex,
  slideTotal,
}) => {
  const tokens = useMemo(
    () => deriveEmotionalDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );
  const isOnImage = image !== null;
  const inkColor = isOnImage ? "#FFFFFF" : tokens.ink.base;

  return (
    <SlideComposition variant="product-context" image={image} tokens={tokens}>
      {/* Big item-number badge — anchored top-right of the safe-area */}
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          fontFamily: tokens.typography.fontFamilyMono,
          fontWeight: 700,
          fontSize: 120,
          lineHeight: 1,
          color: isOnImage ? "rgba(255,255,255,0.85)" : tokens.brand[500],
          opacity: 0.95,
        }}
      >
        {String(itemNumber).padStart(2, "0")}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
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
          {beat.eyebrow ?? `Item ${itemNumber}`} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
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
        <div style={{ marginTop: 8 }}>
          <InlineToolMention tool={featuredTool} tokens={tokens} size="prominent" />
        </div>
      </div>
    </SlideComposition>
  );
};
