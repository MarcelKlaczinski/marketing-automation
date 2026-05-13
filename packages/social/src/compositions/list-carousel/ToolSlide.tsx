import React from "react";
import { BackgroundLayer } from "../../shared/BackgroundLayer.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { PricingChip } from "../../shared/PricingChip.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { ListCarouselInput, Tool } from "./types.ts";

type Props = {
  input: ListCarouselInput;
  tool: Tool;
  slideNumber: number;
  totalSlides: number;
  theme: ThemeTokens;
  themeMode: "dark" | "light";
};

export function ToolSlide({ input, tool, slideNumber, totalSlides, theme, themeMode }: Props) {
  const { brandTokens } = input;
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
      <BackgroundLayer theme={theme} />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative" }}>
        <Eyebrow
          text={tool.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Tool card */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 40 }}>

        {/* Icon + Name row */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <ToolIconImage
            iconUrl={tool.iconUrl}
            initials={tool.iconInitials}
            hue={tool.iconHue}
            emoji={tool.emoji}
            size={96}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontFamily,
                fontSize: 48,
                fontWeight: headingWeight,
                color: theme.ink,
              }}
            >
              {tool.name}
            </span>
            <span style={{ fontFamily, fontSize: 22, color: theme.inkMuted }}>
              {tool.domain}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: `color-mix(in oklch, ${theme.inkMuted} 27%, transparent)`,
            width: "100%",
          }}
        />

        {/* Best-for tag + Tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tool.bestFor && (
            <span
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "4px 14px",
                borderRadius: 999,
                background: `color-mix(in oklch, ${theme.brand} 15%, transparent)`,
                border: `1px solid color-mix(in oklch, ${theme.brand} 40%, transparent)`,
                fontFamily,
                fontSize: 18,
                fontWeight: 600,
                color: theme.brand,
                letterSpacing: "0.04em",
                textTransform: "uppercase" as const,
              }}
            >
              {tool.bestFor}
            </span>
          )}
          <p
            style={{
              margin: 0,
              fontFamily,
              fontSize: 30,
              lineHeight: 1.4,
              color: theme.ink,
              fontWeight: 500,
            }}
          >
            {tool.tagline}
          </p>
        </div>

        {/* Strengths list */}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          {tool.strengths.map((s, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                fontFamily,
                fontSize: 24,
                color: theme.ink,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: theme.accent,
                  flexShrink: 0,
                  marginTop: 8,
                }}
              />
              {s}
            </li>
          ))}
        </ul>

        {/* Pricing chip */}
        <PricingChip tier={tool.pricing.tier} label={tool.pricing.label} fontFamily={fontFamily} theme={themeMode} />
      </div>

      {/* Bottom: Brand footer */}
      <div style={{ position: "relative" }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={fontFamily}
          slideLabel={`${slideNumber}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
