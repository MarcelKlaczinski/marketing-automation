import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import type { SingleToolSpotlightInput } from "./types.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";

type Props = { input: SingleToolSpotlightInput; slideNumber: number };

function RatingStars({ rating, brand, inkMuted }: { rating: number; brand: string; inkMuted: string }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: full }).map((_, i) => (
        <span key={`f${i}`} style={{ color: brand, fontSize: 32 }}>★</span>
      ))}
      {half && <span style={{ color: brand, fontSize: 32 }}>⭐</span>}
      {Array.from({ length: empty }).map((_, i) => (
        <span key={`e${i}`} style={{ color: inkMuted, fontSize: 32 }}>★</span>
      ))}
      <span style={{ fontFamily: FONT, fontSize: 28, fontWeight: 700, color: brand, marginLeft: 8 }}>
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

export function StrengthsSlide({ input, slideNumber }: Props) {
  const { tool, theme: themeMode, locale, websiteUrl, instagramHandle, totalSlides } = input;
  const theme = getThemeTokens(undefined, themeMode);

  const eyebrow = locale === "de" ? "STÄRKEN" : "STRENGTHS";
  const headlineLead = locale === "de" ? "Warum" : "Why";
  const headlineHighlight = locale === "de" ? `${tool.name}?` : `${tool.name}?`;

  const [starPro, ...restPros] = tool.pros;

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
      {/* Background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 80% 50% at 50% 110%, color-mix(in oklch, ${theme.brand} 10%, transparent), transparent 60%)`,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Tool name context anchor top row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 48 }}>
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            hue={tool.iconHue ?? 220}
            size={56}
          />
          <div>
            <Eyebrow text={eyebrow} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />
            <div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 700, color: theme.ink, marginTop: 4 }}>
              {tool.name}
            </div>
          </div>
        </div>

        {/* Headline */}
        <div>
          <span style={{ fontFamily: FONT, fontSize: 80, fontWeight: 800, color: theme.ink, lineHeight: 1.05 }}>
            {headlineLead}{" "}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 80, fontWeight: 900, color: theme.brand, lineHeight: 1.05 }}>
            {headlineHighlight}
          </span>
        </div>

        {/* Rating */}
        {tool.rating !== undefined && (
          <div style={{ marginTop: 32 }}>
            <RatingStars rating={tool.rating} brand={theme.brand} inkMuted={theme.inkMuted} />
          </div>
        )}

        {/* Star strength — featured, large */}
        {starPro && (
          <div
            style={{
              marginTop: 40,
              padding: "28px 36px",
              borderRadius: 20,
              background: `color-mix(in oklch, ${theme.brand} 12%, transparent)`,
              borderLeft: `6px solid ${theme.brand}`,
              boxShadow: `0 4px 32px color-mix(in oklch, ${theme.brand} 15%, transparent)`,
            }}
          >
            <div
              style={{
                fontFamily: FONT,
                fontSize: 18,
                fontWeight: 700,
                color: theme.brand,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                marginBottom: 10,
              }}
            >
              {locale === "de" ? "Top-Stärke" : "Top strength"}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 36, fontWeight: 800, color: theme.ink, lineHeight: 1.25 }}>
              {starPro.text}
            </div>
          </div>
        )}

        {/* Remaining pros — visual stagger via opacity: each item slightly less
            prominent than the last, creating natural reading hierarchy.
            Clamped at 0.65 so no item becomes unreadable. */}
        {restPros.length > 0 && (
          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            {restPros.map((pro, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 18,
                  opacity: Math.max(0.65, 1 - i * 0.12),
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: theme.accent,
                    flexShrink: 0,
                    marginTop: 12,
                    opacity: Math.max(0.65, 1 - i * 0.08),
                  }}
                />
                <span style={{ fontFamily: FONT, fontSize: 30, fontWeight: 500, color: theme.ink, lineHeight: 1.3 }}>
                  {pro.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Cons — compact, if any */}
        {tool.cons.length > 0 && (
          <div
            style={{
              marginTop: 36,
              padding: "20px 28px",
              borderRadius: 14,
              background: themeMode === "dark" ? "oklch(20% 0.02 10)" : "oklch(96% 0.01 10)",
              borderLeft: `4px solid color-mix(in oklch, ${theme.inkMuted} 40%, transparent)`,
            }}
          >
            <div
              style={{
                fontFamily: FONT,
                fontSize: 17,
                fontWeight: 700,
                color: theme.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                marginBottom: 10,
              }}
            >
              {locale === "de" ? "Schwächen" : "Weaknesses"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tool.cons.slice(0, 3).map((con, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <span style={{ color: theme.inkMuted, fontSize: 22, lineHeight: 1.3, flexShrink: 0 }}>–</span>
                  <span style={{ fontFamily: FONT, fontSize: 24, fontWeight: 400, color: theme.inkMuted, lineHeight: 1.3 }}>
                    {con.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ position: "absolute", bottom: 72, left: SZ.PAD_X, right: SZ.PAD_X }}>
        <BrandFooter
          websiteUrl={websiteUrl}
          instagramHandle={instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`${slideNumber}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
