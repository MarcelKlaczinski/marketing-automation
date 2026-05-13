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
        padding: 72,
        paddingBottom: 140,
        boxSizing: "border-box",
      }}
    >
      <BackgroundLayer theme={theme} aurora />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative", marginBottom: 48 }}>
        <Eyebrow
          text="ZUR VERTIEFUNG"
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Content: fills remaining space */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 52, flex: 1 }}>
        <div
          style={{
            fontFamily,
            fontSize: 84,
            fontWeight: headingWeight,
            lineHeight: 1.1,
            color: theme.ink,
          }}
        >
          <span>{end.headline} </span>
          <span style={{ color: theme.brand }}>{end.headlineHighlight}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* CTA 1: Folge uns */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "28px 36px",
              background: `color-mix(in oklch, ${theme.accent} 12%, transparent)`,
              borderRadius: 20,
              border: `1.5px solid color-mix(in oklch, ${theme.accent} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 44 }}>📱</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily, fontSize: 22, fontWeight: 500, color: theme.inkMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                Folge uns für mehr Reviews
              </span>
              <span style={{ fontFamily, fontSize: 36, fontWeight: 700, color: theme.accent }}>
                {brandTokens.social.instagramHandle}
              </span>
            </div>
          </div>

          {/* CTA 2: Artikel lesen */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "28px 36px",
              background: `color-mix(in oklch, ${theme.brand} 12%, transparent)`,
              borderRadius: 20,
              border: `1.5px solid color-mix(in oklch, ${theme.brand} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 44 }}>🌐</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily, fontSize: 22, fontWeight: 500, color: theme.inkMuted, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                Vollständiger Artikel
              </span>
              <span style={{ fontFamily, fontSize: 30, fontWeight: 700, color: theme.brand, wordBreak: "break-all" }}>
                {end.articleUrl.replace(/^https?:\/\//, "")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer: absolute so it never pushes content */}
      <div style={{ position: "absolute", bottom: 72, left: 72, right: 72 }}>
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
