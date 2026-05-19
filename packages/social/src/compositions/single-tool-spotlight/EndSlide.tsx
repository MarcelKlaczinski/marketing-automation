import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsGlow } from "../../ds-components/DsGlow";

interface EndSlideProps {
  content: { ctaLine: string; url: string };
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
}

export const EndSlide: React.FC<EndSlideProps> = ({ content, theme, brandTokens }) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

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
      {/* Ambient glow — top-right brand */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="top-right"
        color="brand"
        size={900}
        inset={-240}
        blur={70}
        alpha={theme === "dark" ? 32 : 24}
      />

      {/* Centered CTA */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          padding: "0 80px",
        }}
      >
        {/* Decorative brand mark — two-letter monogram in a gradient circle */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${tokens.brand[500]}, ${tokens.brand[900]})`,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 40px",
            boxShadow: `0 0 60px color-mix(in oklab, ${tokens.brand[500]} 30%, transparent)`,
          }}
        >
          <svg
            width={44}
            height={44}
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* Bookmark / save icon — "save this article" metaphor */}
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        {/* CTA text */}
        <div
          style={{
            fontSize: 28,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 500,
            color: tokens.ink.muted,
            lineHeight: 1.4,
          }}
        >
          {content.ctaLine}
        </div>

        {/* URL — bold, prominent */}
        <div
          style={{
            fontSize: 32,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: tokens.typography.headingWeight,
            color: tokens.ink.base,
            marginTop: 12,
            letterSpacing: "-0.02em",
          }}
        >
          {content.url}
        </div>

        {/* Accent line decoration */}
        <div
          style={{
            width: 80,
            height: 3,
            borderRadius: 2,
            background: tokens.accent[500],
            margin: "32px auto 0",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
