import React from "react";
import { BackgroundLayer } from "../../shared/BackgroundLayer.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
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

// Split tagline to wrap keyDifferentiator in a highlighted span
function renderTaglineWithHighlight(
  tagline: string,
  keyDifferentiator: string | undefined,
  brand: string,
): React.ReactNode {
  if (!keyDifferentiator || !tagline.toLowerCase().includes(keyDifferentiator.toLowerCase())) {
    return tagline;
  }
  const idx = tagline.toLowerCase().indexOf(keyDifferentiator.toLowerCase());
  const before = tagline.slice(0, idx);
  const match = tagline.slice(idx, idx + keyDifferentiator.length);
  const after = tagline.slice(idx + keyDifferentiator.length);
  return (
    <>
      {before}
      <span style={{ color: brand, fontWeight: 800 }}>{match}</span>
      {after}
    </>
  );
}

export function ToolSlideStunning({ input, tool, slideNumber, totalSlides, theme, themeMode }: Props) {
  const { brandTokens } = input;
  const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;

  const rankNum = tool.rank;
  const rankLabel = `#${String(rankNum).padStart(2, "0")}`;
  const toolNameUpper = tool.name.toUpperCase();

  // Determine which strength is "star" — use starStrength if available, else first strength
  const starStrength = tool.starStrength ?? tool.strengths[0];
  const regularStrengths = tool.strengths.filter((s) => s !== starStrength).slice(0, 3);

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
      <BackgroundLayer theme={theme} />

      {/* Top: Rank badge + tool name eyebrow */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 36 }}>
        {/* Rank badge — big, brand color */}
        <span
          style={{
            fontFamily,
            fontSize: 72,
            fontWeight: 900,
            color: theme.brand,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          {rankLabel}
        </span>

        {/* Tool name in eyebrow style */}
        <span
          style={{
            fontFamily,
            fontSize: 20,
            fontWeight: 700,
            color: theme.inkMuted,
            letterSpacing: eyebrowLetterSpacing,
            textTransform: "uppercase" as const,
            paddingBottom: 8,
          }}
        >
          {toolNameUpper}
        </span>
      </div>

      {/* Center: Tool card — fills remaining space */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 36, flex: 1 }}>

        {/* Icon (prominent) + Name row */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* Larger icon with brand ring */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: -3,
                borderRadius: "50%",
                border: `2.5px solid color-mix(in oklch, ${theme.brand} 50%, transparent)`,
              }}
            />
            <ToolIconImage
              {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
              {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
              {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
              size={128}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontFamily,
                fontSize: 52,
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

        {/* Best-for tag + Tagline with highlight word */}
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
            {renderTaglineWithHighlight(tool.tagline, tool.keyDifferentiator, theme.brand)}
          </p>
        </div>

        {/* Strengths list — star first, then regular */}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Star strength — prominent */}
          {starStrength && (
            <li
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                fontFamily,
                fontSize: 30,
                fontWeight: 700,
                color: theme.brand,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: theme.brand,
                  flexShrink: 0,
                  marginTop: 8,
                  boxShadow: `0 0 8px color-mix(in oklch, ${theme.brand} 60%, transparent)`,
                }}
              />
              {starStrength}
            </li>
          )}

          {/* Regular strengths */}
          {regularStrengths.map((s, i) => (
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

        {/* Pricing chip — more prominent */}
        <div
          style={{
            border: `2px solid color-mix(in oklch, ${theme.brand} 25%, transparent)`,
            borderRadius: 16,
            padding: "4px",
            alignSelf: "flex-start",
          }}
        >
          <PricingChip tier={tool.pricing.tier} label={tool.pricing.label} fontFamily={fontFamily} theme={themeMode} />
        </div>
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
