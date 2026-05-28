/**
 * Spec 65.8 — opinion-recommendation Reasoning slide.
 *
 * `immersive` variant rendered GRADIENT-ONLY (image={null}). Per spec §3.7
 * Option γ: Reasoning slides are text-heavy and benefit from a clean
 * gradient backdrop — a photographic background would compete with the
 * analytical text. Big "01" / "02" badge anchors the argument-counter
 * rhythm (similar pattern to lifestyle-listicle's item-number badge but
 * smaller since Reasoning is text-led, not image-led).
 */
import type React from "react";
import { useMemo } from "react";
import { resolveBrandTokens } from "../../../lib/brand-tokens.ts";
import { deriveTokensForRender, type PresetKey } from "../../../presets/index.ts";
import { SlideComposition } from "../../_shared/family-b/SlideComposition.tsx";
import type { FamilyBNarrativeBeat } from "../../_shared/family-b/types.ts";

interface ReasoningSlideProps {
  beat: FamilyBNarrativeBeat;
  /** 1-based reasoning index (1 or 2). */
  reasoningNumber: number;
  brandTokens?: unknown;
  theme: "dark" | "light";
  /** Spec 65.16 — Visual-style preset; aliases preset values into legacy token slots. */
  preset?: PresetKey | null;
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
}

export const ReasoningSlide: React.FC<ReasoningSlideProps> = ({
  beat,
  reasoningNumber,
  brandTokens,
  theme,
  preset,
  locale,
  slideIndex,
  slideTotal,
}) => {
  const tokens = useMemo(
    () => deriveTokensForRender(resolveBrandTokens(brandTokens), theme, preset ?? null),
    [brandTokens, theme, preset],
  );
  const eyebrowLabel = locale === "de" ? "Begründung" : "Reasoning";

  return (
    <SlideComposition variant="immersive" image={null} tokens={tokens}>
      {/* Reasoning-number badge — top-right, smaller than item-badge (text-led). */}
      <div
        style={{
          position: "absolute",
          top: 56,
          right: 56,
          fontFamily: tokens.typography.fontFamilyMono,
          fontWeight: 700,
          fontSize: 80,
          lineHeight: 1,
          color: tokens.accent[500],
          opacity: 0.6,
        }}
      >
        {String(reasoningNumber).padStart(2, "0")}
      </div>
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
          {beat.eyebrow ?? `${eyebrowLabel} ${reasoningNumber}`} · {String(slideIndex + 1).padStart(2, "0")} / {String(slideTotal).padStart(2, "0")}
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
      </div>
    </SlideComposition>
  );
};
