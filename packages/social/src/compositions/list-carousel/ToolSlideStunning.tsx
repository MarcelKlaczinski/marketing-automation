import React from "react";
import { BackgroundLayer } from "../../shared/BackgroundLayer.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { PricingChip } from "../../shared/PricingChip.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { ListCarouselInput, Tool } from "./types.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "./safeZones.ts";

type Props = {
  input: ListCarouselInput;
  tool: Tool;
  slideNumber: number;
  totalSlides: number;
  theme: ThemeTokens;
  themeMode: "dark" | "light";
};

/**
 * Mirror of pipelines/.../enrichment/toolUseCaseTokens.ts → deriveInfinitiveUseCase.
 * Kept inline so the Remotion bundle stays self-contained (no cross-package import).
 * Turns "designst Logos" → "Logos designen" for natural German word order.
 */
function deriveInfinitiveUseCase(identityVerb: string): string | null {
  const match = identityVerb.trim().match(
    /^(designst|machst|schreibst|baust|erstellst|generierst|nutzt|brauchst|willst|suchst|erzeugst)\s+(.+)$/i,
  );
  if (!match) return null;
  const [, verb, object] = match;
  if (!verb || !object) return null;
  const lower = verb.toLowerCase();
  const infinitive = lower === "nutzt" ? "nutzen" : lower.replace(/st$/, "en");
  return `${object} ${infinitive}`;
}

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
        width: SZ.CANVAS_W,
        height: SZ.CANVAS_H_4_5,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: SZ.PAD_X,
        paddingBottom: SZ.PAD_Y_BOTTOM,
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

      {/* Center: Tool card — fills remaining space.
          Spec 51a-stunning-v2.1 follow-up: bigger fonts + extra For-you panel
          so the 4:5 canvas reads dense instead of half-empty. */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 64, flex: 1 }}>

        {/* Icon (prominent) + Name row */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
            size={144}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontFamily,
                fontSize: 64,
                fontWeight: headingWeight,
                color: theme.ink,
                lineHeight: 1,
              }}
            >
              {tool.name}
            </span>
            <span style={{ fontFamily, fontSize: 24, color: theme.inkMuted }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
                fontWeight: 700,
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
            {renderTaglineWithHighlight(tool.tagline, tool.keyDifferentiator, theme.brand)}
          </p>
        </div>

        {/* Strengths list — star first, then regular */}
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Star strength — prominent */}
          {starStrength && (
            <li
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 18,
                fontFamily,
                fontSize: 38,
                fontWeight: 800,
                color: theme.brand,
                lineHeight: 1.2,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: theme.brand,
                  flexShrink: 0,
                  marginTop: 12,
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
                gap: 18,
                fontFamily,
                fontSize: 30,
                color: theme.ink,
                lineHeight: 1.25,
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

        {/* "Perfekt für" panel — derives the infinitive use-case ("Logos
            designen") from the du-form identityVerb so the German word order
            is natural. Falls through cleanly when no token is available. */}
        {(() => {
          const useCase = tool.identityVerb ? deriveInfinitiveUseCase(tool.identityVerb) : null;
          if (!useCase) return null;
          return (
            <div
              style={{
                padding: "24px 28px",
                borderRadius: 18,
                background: `color-mix(in oklch, ${theme.brand} 10%, transparent)`,
                borderLeft: `5px solid ${theme.brand}`,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily,
                  fontSize: 18,
                  fontWeight: 700,
                  color: theme.inkMuted,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                }}
              >
                Perfekt für
              </span>
              <span style={{ fontFamily, fontSize: 36, fontWeight: 800, color: theme.ink, lineHeight: 1.15 }}>
                {useCase}.
              </span>
            </div>
          );
        })()}

        {/* Pricing chip — centered with extra bottom margin so it breathes
            clear of the footer. */}
        <div
          style={{
            marginBottom: 100,
            border: `2px solid color-mix(in oklch, ${theme.brand} 25%, transparent)`,
            borderRadius: 16,
            padding: "4px",
            alignSelf: "center",
          }}
        >
          <PricingChip tier={tool.pricing.tier} label={tool.pricing.label} fontFamily={fontFamily} theme={themeMode} />
        </div>
      </div>

      {/* Footer: absolute so it never pushes content */}
      <div style={{ position: "absolute", bottom: SZ.PAD_X, left: SZ.PAD_X, right: SZ.PAD_X }}>
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
