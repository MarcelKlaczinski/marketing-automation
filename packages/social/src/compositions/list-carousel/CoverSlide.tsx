import React from "react";
import { BackgroundLayer } from "../../shared/BackgroundLayer.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { ListCarouselInput } from "./types.ts";

type Props = {
  input: ListCarouselInput;
  theme: ThemeTokens;
  totalSlides: number;
};

export function CoverSlide({ input, theme, totalSlides }: Props) {
  const { cover, brandTokens } = input;
  const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;

  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        boxSizing: "border-box",
      }}
    >
      <BackgroundLayer theme={theme} cover />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative" }}>
        <Eyebrow
          text={cover.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Headline */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            fontFamily,
            fontSize: 84,
            fontWeight: headingWeight,
            lineHeight: 1.05,
            color: theme.ink,
          }}
        >
          <span>{cover.headlineLead} </span>
          <span style={{ color: theme.brand }}>{cover.headlineHighlight}</span>
          {cover.headlineTrail && <span> {cover.headlineTrail}</span>}
        </div>

        {cover.subhead && (
          <p
            style={{
              margin: 0,
              fontFamily,
              fontSize: 28,
              color: theme.inkMuted,
              fontWeight: 400,
              letterSpacing: "0.01em",
            }}
          >
            {cover.subhead}
          </p>
        )}
      </div>

      {/* Bottom: Brand footer */}
      <div style={{ position: "relative" }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={fontFamily}
          slideLabel={`1/${totalSlides}`}
        />
      </div>
    </div>
  );
}
