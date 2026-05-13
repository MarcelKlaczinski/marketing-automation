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

      {/* Center: Headline + two CTAs */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 48 }}>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* CTA 1: Folge uns */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "24px 32px",
              background: `color-mix(in oklch, ${theme.accent} 12%, transparent)`,
              borderRadius: 18,
              border: `1.5px solid color-mix(in oklch, ${theme.accent} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 36 }}>📱</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily, fontSize: 18, fontWeight: 500, color: theme.inkMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                Folge uns für mehr Reviews
              </span>
              <span style={{ fontFamily, fontSize: 30, fontWeight: 700, color: theme.accent }}>
                {brandTokens.social.instagramHandle}
              </span>
            </div>
          </div>

          {/* CTA 2: Artikel lesen */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "24px 32px",
              background: `color-mix(in oklch, ${theme.brand} 12%, transparent)`,
              borderRadius: 18,
              border: `1.5px solid color-mix(in oklch, ${theme.brand} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 36 }}>🌐</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily, fontSize: 18, fontWeight: 500, color: theme.inkMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                Vollständiger Artikel
              </span>
              <span style={{ fontFamily, fontSize: 26, fontWeight: 700, color: theme.brand, wordBreak: "break-all" }}>
                {end.articleUrl.replace(/^https?:\/\//, "")}
              </span>
            </div>
          </div>
        </div>
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
