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

export function UseCaseDetailSlide({ input, slideNumber }: Props) {
  const { tool, theme: themeMode, locale, websiteUrl, instagramHandle, totalSlides } = input;
  const theme = getThemeTokens(undefined, themeMode);

  const eyebrow = locale === "de" ? "USE CASES" : "USE CASES";
  const headline = locale === "de" ? "Wofür?" : "Best for?";

  const useCases = tool.useCases.slice(0, 4);

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
          background: `radial-gradient(ellipse 75% 55% at 50% 100%, color-mix(in oklch, ${theme.accent} 8%, transparent), transparent 60%)`,
        }}
      />

      {/* Ghost number */}
      <div
        style={{
          position: "absolute",
          right: -10,
          bottom: 80,
          fontFamily: FONT,
          fontSize: 480,
          fontWeight: 900,
          color: theme.ink,
          opacity: themeMode === "dark" ? 0.05 : 0.03,
          lineHeight: 1,
          userSelect: "none",
          letterSpacing: "-0.05em",
        }}
      >
        {useCases.length}
      </div>

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Tool context */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 44 }}>
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            hue={tool.iconHue ?? 220}
            size={52}
          />
          <div>
            <Eyebrow text={eyebrow} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />
            <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: theme.ink, marginTop: 4 }}>
              {tool.name}
            </div>
          </div>
        </div>

        {/* Headline */}
        <div style={{ fontFamily: FONT, fontSize: 80, fontWeight: 800, color: theme.ink, lineHeight: 1.05 }}>
          {headline}
        </div>

        {/* Use case cards */}
        <div style={{ marginTop: 52, display: "flex", flexDirection: "column", gap: 20 }}>
          {useCases.map((uc, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "22px 28px",
                borderRadius: 16,
                background: i === 0
                  ? `color-mix(in oklch, ${theme.brand} 12%, transparent)`
                  : (themeMode === "dark" ? "oklch(22% 0.025 250)" : "oklch(94% 0.01 250)"),
                borderLeft: i === 0 ? `6px solid ${theme.brand}` : `6px solid color-mix(in oklch, ${theme.inkMuted} 20%, transparent)`,
              }}
            >
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: 22,
                  fontWeight: 800,
                  color: i === 0 ? theme.brand : theme.inkMuted,
                  minWidth: 36,
                  textAlign: "center" as const,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: i === 0 ? 30 : 28,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? theme.ink : theme.inkMuted,
                  lineHeight: 1.3,
                }}
              >
                {uc}
              </span>
            </div>
          ))}
        </div>
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
