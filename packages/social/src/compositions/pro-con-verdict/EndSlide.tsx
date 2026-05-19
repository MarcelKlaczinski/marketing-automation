import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { resolveProsColor, resolveConsColor } from "./colors.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

type Props = { input: ProConVerdictInput; slideNumber: number; totalSlides: number };

export function EndSlide({ input, slideNumber, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const prosColor = resolveProsColor(brandTokens);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";

  const eyebrowText = isDE ? "ZUR VERTIEFUNG" : "DIVE DEEPER";
  const ctaLine1 = isDE ? "Speichere diesen" : "Save this";
  const ctaLine2Lead = isDE ? "Post" : "post";
  const ctaLine2Highlight = isDE ? "für später." : "for later.";
  const articleLabel = isDE ? "Vollständiger Test" : "Full review";
  const reviewedLabel = isDE ? "Bewertet" : "Reviewed";
  const saveLabel = isDE ? "MERKEN" : "SAVE";
  const followLabel = isDE ? "FOLGEN" : "FOLLOW";

  return (
    <div
      style={{
        width: SZ.CANVAS_W,
        height: SZ.CANVAS_H_4_5,
        background: theme.bg,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: `${SZ.PAD_Y_TOP}px ${SZ.PAD_X}px`,
        paddingBottom: SZ.PAD_Y_BOTTOM,
        boxSizing: "border-box",
      }}
    >
      {/* Aurora background — dual-color to echo the split cover */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 80% 60% at 50% 110%, color-mix(in oklch, ${theme.brand} 16%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 40% 40% at 10% 50%, color-mix(in oklch, ${prosColor} 6%, transparent), transparent 55%),
            radial-gradient(ellipse 40% 40% at 90% 50%, color-mix(in oklch, ${consColor} 6%, transparent), transparent 55%)
          `,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrowText} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />

        {/* CTA headline */}
        <div style={{ marginTop: 52 }}>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, lineHeight: 1.1, color: theme.ink }}>
            {ctaLine1}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
            <span style={{ color: theme.ink }}>{ctaLine2Lead} </span>
            <span style={{ color: theme.brand, fontWeight: 900 }}>{ctaLine2Highlight}</span>
          </div>
        </div>

        {/* Action cards */}
        <div style={{ marginTop: 56, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Save card */}
          <div
            style={{
              padding: "24px 28px",
              borderRadius: 16,
              background: themeMode === "dark" ? "oklch(20% 0.025 250)" : "oklch(95% 0.01 250)",
              border: `1px solid color-mix(in oklch, ${theme.brand} 20%, transparent)`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: theme.brand, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
              {saveLabel}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 600, color: theme.brand }}>
              {isDE ? `${tool.name}-Bewertung` : `${tool.name} review`}
            </div>
          </div>

          {/* Follow card */}
          <div
            style={{
              padding: "24px 28px",
              borderRadius: 16,
              background: themeMode === "dark" ? "oklch(20% 0.025 250)" : "oklch(95% 0.01 250)",
              border: `1px solid color-mix(in oklch, ${theme.inkMuted} 15%, transparent)`,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: theme.inkMuted, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
              {followLabel}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: theme.brand }}>
              {brandTokens.social.instagramHandle}
            </div>
          </div>
        </div>

        {/* Tool recap */}
        <div
          style={{
            marginTop: 40,
            padding: "20px 28px",
            borderRadius: 16,
            background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
            border: `1px solid color-mix(in oklch, ${theme.inkMuted} 15%, transparent)`,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 700,
              color: theme.inkMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              whiteSpace: "nowrap" as const,
              flexShrink: 0,
            }}
          >
            {reviewedLabel}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: FONT, fontSize: 26, fontWeight: 800, color: theme.ink }}>
              {tool.name}
            </span>
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 72, left: SZ.PAD_X, right: SZ.PAD_X }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`${slideNumber}/${totalSlides}`}
          brandTokens={brandTokens}
        />
      </div>
    </div>
  );
}
