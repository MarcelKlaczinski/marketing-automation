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
        padding: 72,
        paddingBottom: 140, // room for absolute footer
        boxSizing: "border-box",
      }}
    >
      <BackgroundLayer theme={theme} />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative", marginBottom: 48 }}>
        <Eyebrow
          text={tool.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Content: fills remaining space */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 44, flex: 1 }}>

        {/* Icon + Name row */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
            size={116}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily,
                fontSize: 60,
                fontWeight: headingWeight,
                color: theme.ink,
              }}
            >
              {tool.name}
            </span>
            <span style={{ fontFamily, fontSize: 26, color: theme.inkMuted }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {tool.bestFor && (
            <span
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                padding: "6px 18px",
                borderRadius: 999,
                background: `color-mix(in oklch, ${theme.brand} 15%, transparent)`,
                border: `1px solid color-mix(in oklch, ${theme.brand} 40%, transparent)`,
                fontFamily,
                fontSize: 20,
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
              fontSize: 36,
              lineHeight: 1.35,
              color: theme.ink,
              fontWeight: 500,
            }}
          >
            {tool.tagline}
          </p>
        </div>

        {/* Strengths list */}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 16 }}>
          {tool.strengths.map((s, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                fontFamily,
                fontSize: 30,
                color: theme.ink,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: theme.accent,
                  flexShrink: 0,
                  marginTop: 10,
                }}
              />
              {s}
            </li>
          ))}
        </ul>

        {/* Pricing chip */}
        <PricingChip tier={tool.pricing.tier} label={tool.pricing.label} fontFamily={fontFamily} theme={themeMode} />
      </div>

      {/* Footer: absolute so it never pushes content */}
      <div style={{ position: "absolute", bottom: 72, left: 72, right: 72 }}>
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
