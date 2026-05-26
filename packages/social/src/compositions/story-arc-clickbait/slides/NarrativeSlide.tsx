/**
 * Spec 65.8 — story-arc-clickbait reusable narrative slide.
 *
 * Setup / Conflict / Resolution / Payoff / Lesson all share the same shape:
 * an optional eyebrow label + 2-4 sentences of first-person narrative +
 * optional inline tool mention chip. Differences:
 *   - composition variant: setup/lesson = `immersive` with no image,
 *     conflict/payoff = `immersive` with image, resolution = `immersive`
 *     with image (tool mention rendered after the text body).
 *   - text alignment: variant handles via SlideComposition (bottom-aligned
 *     for immersive).
 *
 * Pattern §3.3 Option γ variable propagation is handled at the validator
 * layer (narrative-prompt.ts `validateStoryArcNarrative`) — by the time
 * this component renders, the text already mentions the hook variables.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { InlineToolMention } from "../../_shared/family-b/InlineToolMention.tsx";
import { SlideComposition, type SlideCompositionVariant } from "../../_shared/family-b/SlideComposition.tsx";
import type {
  FamilyBImage,
  FamilyBNarrativeBeat,
  FamilyBToolMention,
} from "../../_shared/family-b/types.ts";

interface NarrativeSlideProps {
  beat: FamilyBNarrativeBeat;
  image: FamilyBImage | null;
  /** Optional inline tool chip — included only on resolution/payoff per spec §3.2. */
  tool: FamilyBToolMention | null;
  variant: SlideCompositionVariant;
  brandTokens?: unknown;
  theme: "dark" | "light";
  slideIndex: number;
  slideTotal: number;
}

export const NarrativeSlide: React.FC<NarrativeSlideProps> = ({
  beat,
  image,
  tool,
  variant,
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
  // Eyebrow uses accent on solid surfaces; on image-bearing slides drop to
  // 95% white for crisper contrast against arbitrary photo content.
  const eyebrowColor = isOnImage ? "rgba(255,255,255,0.95)" : tokens.accent[500];

  return (
    <SlideComposition variant={variant} image={image} tokens={tokens}>
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
            color: eyebrowColor,
          }}
        >
          {beat.eyebrow ?? beat.beatName} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
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
        {tool && (
          <div style={{ marginTop: 8 }}>
            <InlineToolMention tool={tool} tokens={tokens} size="prominent" />
          </div>
        )}
      </div>
    </SlideComposition>
  );
};
