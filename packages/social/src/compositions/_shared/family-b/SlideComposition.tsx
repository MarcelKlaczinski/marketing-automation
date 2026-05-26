/**
 * Spec 65.8 — Family-B SlideComposition with 4 layout variants.
 *
 * Per spec §3.11 Option δ ("Variable per slide-type") each Family-B slide
 * picks ONE of 4 composition variants based on its narrative role:
 *
 *   - `cover`           → split-layout (image top 55%, text bottom 45%)
 *                         used for hook covers — image as headline-impact,
 *                         hook-text below in clean text block.
 *   - `immersive`       → image at 40% opacity + linear gradient overlay
 *                         used for narrative beats (setup/conflict/etc.) —
 *                         image-prominent + readable bottom text.
 *   - `product-context` → image at 70% opacity + brand-color overlay
 *                         used for item slides where the product is the
 *                         focus — brand-presence is strong.
 *   - `editorial`       → split-layout (alias of cover; reused for hot-take /
 *                         top-pick "editorial" moments). Identical impl;
 *                         kept as a distinct semantic variant so future
 *                         tweaks can diverge them without renaming call sites.
 *
 * When `image` is null (gradient-only slide per spec §3.7 Option γ), the
 * component renders a clean gradient background using the emotional surface
 * + brand-color stops. Caller has full control over content via `children`.
 */
import type React from "react";
import { AbsoluteFill } from "remotion";
import type { EmotionalDsTokens } from "./ds-tokens-emotional.ts";
import type { FamilyBImage } from "./types.ts";

export type SlideCompositionVariant = "cover" | "immersive" | "product-context" | "editorial";

interface SlideCompositionProps {
  variant: SlideCompositionVariant;
  /** Photographic background — null when slide is gradient-only. */
  image: FamilyBImage | null;
  tokens: EmotionalDsTokens;
  children: React.ReactNode;
}

const SAFE_TEXT_COLOR = (tokens: EmotionalDsTokens, isOnImage: boolean): string =>
  isOnImage ? "#FFFFFF" : tokens.ink.base;

// ─── Variant: cover (split-layout — image top, text bottom) ───────────────────

const CoverComposition: React.FC<Omit<SlideCompositionProps, "variant">> = ({
  image,
  tokens,
  children,
}) => {
  return (
    <AbsoluteFill style={{ background: tokens.surface.base, color: SAFE_TEXT_COLOR(tokens, false) }}>
      {image && (
        <div style={{ position: "absolute", inset: 0, top: 0, height: "55%", overflow: "hidden" }}>
          <img
            src={image.cdnUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: image ? "55%" : 0,
          padding: tokens.layout.padding,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: image ? tokens.surface.base : tokens.emotion.primary,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ─── Variant: immersive (image bg + gradient overlay → readable text) ─────────

const ImmersiveComposition: React.FC<Omit<SlideCompositionProps, "variant">> = ({
  image,
  tokens,
  children,
}) => {
  if (!image) {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${tokens.emotion.primary} 0%, ${tokens.surface.base} 100%)`,
          color: SAFE_TEXT_COLOR(tokens, false),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: tokens.layout.padding,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: tokens.surface.base }}>
      <img
        src={image.cdnUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: tokens.image.defaultOpacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: tokens.image.gradientOverlay,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: tokens.layout.padding,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          color: SAFE_TEXT_COLOR(tokens, true),
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ─── Variant: product-context (image bg + brand-color overlay) ────────────────

const ProductContextComposition: React.FC<Omit<SlideCompositionProps, "variant">> = ({
  image,
  tokens,
  children,
}) => {
  if (!image) {
    return (
      <AbsoluteFill
        style={{
          background: tokens.emotion.primary,
          color: SAFE_TEXT_COLOR(tokens, true),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: tokens.layout.padding,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: tokens.surface.base }}>
      <img
        src={image.cdnUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.7,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: tokens.emotion.imageOverlay,
          mixBlendMode: "multiply",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: tokens.layout.padding,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          color: SAFE_TEXT_COLOR(tokens, true),
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export const SlideComposition: React.FC<SlideCompositionProps> = ({
  variant,
  image,
  tokens,
  children,
}) => {
  switch (variant) {
    case "cover":
    case "editorial":
      return <CoverComposition image={image} tokens={tokens}>{children}</CoverComposition>;
    case "immersive":
      return <ImmersiveComposition image={image} tokens={tokens}>{children}</ImmersiveComposition>;
    case "product-context":
      return <ProductContextComposition image={image} tokens={tokens}>{children}</ProductContextComposition>;
    default: {
      const _exhaustive: never = variant;
      void _exhaustive;
      return <ImmersiveComposition image={image} tokens={tokens}>{children}</ImmersiveComposition>;
    }
  }
};
