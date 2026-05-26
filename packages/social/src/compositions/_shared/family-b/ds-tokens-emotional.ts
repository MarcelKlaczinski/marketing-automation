/**
 * Spec 65.8 — Emotional DS-tokens variant for Family B.
 *
 * Extends the base `DsTokens` (from `packages/social/src/brand-tokens/derive.ts`,
 * Spec 60.0b) with emotion-specific surface + image-overlay tokens that
 * Family-B carousels consume.
 *
 * Per spec §3.4 (refined): Family-B slides operate at a different visual
 * register than Family-A. Where Family-A uses flat brand-color surfaces
 * with crisp tool grids, Family-B alternates between:
 *   - Photographic backgrounds (4:5 image at 40% opacity) with a strong
 *     gradient overlay toward the bottom-text area.
 *   - Brand-saturated emotional surfaces for transition / gradient-only
 *     slides (no photographic background available or design choice).
 *
 * The emotional variant declares the additional token slots required by
 * `SlideComposition` (4 variants per spec §3.11 Option δ) without
 * duplicating the entire base token set.
 */
import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";
import { deriveDsTokens, type DsTokens } from "../../../brand-tokens/derive.ts";

/**
 * Family-B-specific overlay + image tokens layered on top of `DsTokens`.
 * Templates consume `EmotionalDsTokens.image` for photographic-slide
 * composition and `EmotionalDsTokens.emotion` for gradient-fallback slides.
 */
export interface EmotionalDsTokens extends DsTokens {
  emotion: {
    /** Primary emotion surface — saturated brand at high lightness for warmth. */
    primary: string;
    /** Secondary surface — complementary accent for hot-take / contrast slides. */
    secondary: string;
    /** Solid fallback surface when no image is available (gradient base color). */
    surface: string;
    /** Semi-transparent overlay layered over photographic backgrounds. */
    imageOverlay: string;
  };
  layout: {
    /** Outer padding for emotional slides — wider than Family-A for breathing room. */
    padding: number;
    /** Max width for text columns over photographic backgrounds. */
    maxTextWidth: number;
  };
  image: {
    /** Aspect-ratio hint matching the 1080×1350 canvas. */
    aspectRatio: "4:5";
    /** Default opacity when image is rendered as a background layer (per spec §3.11 Option β default). */
    defaultOpacity: number;
    /** Linear gradient overlay applied above the image, transparent at top → surface at bottom. */
    gradientOverlay: string;
  };
}

/**
 * Derive emotional DS-tokens from BrandTokens. Calls the base `deriveDsTokens`
 * for the shared brand/surface/ink stops, then layers Family-B-specific tokens.
 *
 * Pure function — call inside `useMemo` in slide components per the
 * `src/compositions/CLAUDE.md` consumption pattern.
 */
export function deriveEmotionalDsTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
): EmotionalDsTokens {
  const base = deriveDsTokens(brandTokens, theme);
  const isDark = theme === "dark";

  const surface = base.surface.base;
  // Gradient: transparent at top, fading to opaque surface at ~70% so the
  // bottom-third reads as a solid surface for text overlay (spec §3.11 Option β).
  const gradientOverlay = `linear-gradient(180deg, transparent 0%, ${surface} 70%, ${surface} 100%)`;

  return {
    ...base,
    emotion: {
      primary: base.brand[isDark ? 700 : 500],
      secondary: base.accent[isDark ? 600 : 500],
      surface,
      // Semi-transparent brand color for product-context slides (spec §3.11 Option α).
      imageOverlay: `color-mix(in oklch, ${base.brand[500]} 40%, transparent)`,
    },
    layout: {
      padding: 96,
      maxTextWidth: 720,
    },
    image: {
      aspectRatio: "4:5",
      defaultOpacity: 0.4,
      gradientOverlay,
    },
  };
}
