import React from "react";
import type { DsTokens } from "../brand-tokens/derive";

export type GlowCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface DsGlowProps {
  tokens: DsTokens;
  theme: "dark" | "light";
  corner: GlowCorner;
  color: "brand" | "accent";
  /** Glow size in px. Default 800. Cover uses 880, spotlight 900. */
  size?: number;
  /** Negative offset from corner. Default -240. Single-tool-spotlight uses -300; cover uses asymmetric. */
  inset?: number | { x: number; y: number };
  /** Alpha 0-100 (matches DS % value in color-mix). If omitted, defaults per (color, theme). */
  alpha?: number;
  /** Blur in px. Default 60. */
  blur?: number;
}

const DEFAULT_ALPHA: Record<"brand" | "accent", Record<"dark" | "light", number>> = {
  brand: { dark: 28, light: 28 },
  accent: { dark: 22, light: 16 },
};

export const DsGlow: React.FC<DsGlowProps> = ({
  tokens,
  theme,
  corner,
  color,
  size = 800,
  inset = -240,
  alpha,
  blur = 60,
}) => {
  const effectiveAlpha = alpha ?? DEFAULT_ALPHA[color][theme];
  const colorValue = color === "brand" ? tokens.brand[500] : tokens.accent[500];

  const insetX = typeof inset === "object" ? inset.x : inset;
  const insetY = typeof inset === "object" ? inset.y : inset;

  const positionStyle: React.CSSProperties = { position: "absolute" };
  if (corner.startsWith("top")) positionStyle.top = insetY;
  else positionStyle.bottom = insetY;
  if (corner.endsWith("left")) positionStyle.left = insetX;
  else positionStyle.right = insetX;

  return (
    <div
      aria-hidden
      style={{
        ...positionStyle,
        width: size,
        height: size,
        background: `radial-gradient(closest-side, color-mix(in oklab, ${colorValue} ${effectiveAlpha}%, transparent), transparent 70%)`,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
      }}
    />
  );
};
