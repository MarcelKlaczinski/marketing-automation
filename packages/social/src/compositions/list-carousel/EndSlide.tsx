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

export function EndSlide({ input, theme, totalSlides }: Props) {
  const { end, brandTokens } = input;
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
      <BackgroundLayer theme={theme} aurora />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative" }}>
        <Eyebrow
          text="ZUR VERTIEFUNG"
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Headline + URL */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 40 }}>
        <div
          style={{
            fontFamily,
            fontSize: 72,
            fontWeight: headingWeight,
            lineHeight: 1.1,
            color: theme.ink,
          }}
        >
          <span>{end.headline} </span>
          <span style={{ color: theme.brand }}>{end.headlineHighlight}</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "20px 32px",
            background: `${theme.brand}22`,
            borderRadius: 16,
            border: `1.5px solid ${theme.brand}55`,
          }}
        >
          <span
            style={{
              fontFamily,
              fontSize: 28,
              fontWeight: 600,
              color: theme.brand,
              wordBreak: "break-all",
            }}
          >
            {end.articleUrl}
          </span>
        </div>

        {end.qrCodeUrl && (
          <img
            src={end.qrCodeUrl}
            width={180}
            height={180}
            style={{ borderRadius: 12 }}
          />
        )}
      </div>

      {/* Bottom: Brand footer */}
      <div style={{ position: "relative" }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={fontFamily}
          slideLabel={`${totalSlides}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
