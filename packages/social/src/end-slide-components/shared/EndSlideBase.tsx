/**
 * Spec 65.9 — EndSlideBase shared layout primitive.
 *
 * Wraps every concrete end-slide in a consistent themed AbsoluteFill with a
 * brand-tinted glow corner. Each concrete component renders its own copy
 * inside; this base owns the bg / typography / glow accent so all 7 types
 * share visual DNA.
 *
 * Token derivation follows the Spec 60.0b pattern — `resolveBrandTokens` +
 * `deriveDsTokens` once per render, memoised. Parent compositions are
 * expected to have already loaded Inter Variable via `loadFonts.ts`
 * (Spec 60.1 module-level side-effect import).
 */
import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { DsGlow } from "../../ds-components/DsGlow";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import type { EndSlideTheme } from "../types";

export interface EndSlideBaseProps {
  children: React.ReactNode | ((tokens: DsTokens) => React.ReactNode);
  theme: EndSlideTheme;
  brandTokens?: unknown;
  /** Corner where the ambient brand-glow renders. Default top-right. */
  glowCorner?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Tint of the glow — brand-500 or accent-500. Default `brand`. */
  glowColor?: "brand" | "accent";
}

export const EndSlideBase: React.FC<EndSlideBaseProps> = ({
  children,
  theme,
  brandTokens,
  glowCorner = "top-right",
  glowColor = "brand",
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const content = typeof children === "function" ? children(tokens) : children;

  return (
    <AbsoluteFill
      style={{
        background: tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner={glowCorner}
        color={glowColor}
        size={900}
        inset={-240}
        blur={70}
        alpha={theme === "dark" ? 32 : 24}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          padding: "0 96px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        {content}
      </div>
    </AbsoluteFill>
  );
};
