/**
 * Spec 65.8 — lifestyle-listicle Intro slide.
 *
 * `immersive` variant rendered gradient-only (no photographic background)
 * per spec §3.7 Option γ — the Intro slide is the only narrative slide
 * without an image; visual rhythm comes from alternating between the
 * gradient Intro and the 3 photographic Item slides. Tool-mention chip
 * is on the bottom so the audience already sees the protagonist.
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveEmotionalDsTokens } from "../../_shared/family-b/ds-tokens-emotional.ts";
import { InlineToolMention } from "../../_shared/family-b/InlineToolMention.tsx";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type {
  FamilyBNarrativeBeat,
  FamilyBToolMention,
} from "../../_shared/family-b/types.ts";

interface IntroSlideProps {
  beat: FamilyBNarrativeBeat;
  featuredTool: FamilyBToolMention;
  brandTokens?: unknown;
  theme: "dark" | "light";
  slideIndex: number;
  slideTotal: number;
}

export const IntroSlide: React.FC<IntroSlideProps> = ({
  beat,
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

  return (
    <SlideComposition variant="immersive" image={null} tokens={tokens}>
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
            color: tokens.accent[500],
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
            color: tokens.ink.base,
          }}
        >
          {beat.text}
        </p>
        <div style={{ marginTop: 12 }}>
          <InlineToolMention tool={featuredTool} tokens={tokens} size="prominent" />
        </div>
      </div>
    </SlideComposition>
  );
};
