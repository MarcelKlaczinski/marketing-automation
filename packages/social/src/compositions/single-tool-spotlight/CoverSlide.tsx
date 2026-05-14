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

type Props = { input: SingleToolSpotlightInput };

export function CoverSlide({ input }: Props) {
  const { tool, theme: themeMode, locale, websiteUrl, instagramHandle, totalSlides } = input;
  const theme = getThemeTokens(undefined, themeMode);
  const year = new Date().getFullYear();

  const category = tool.primaryCategory?.toUpperCase() ?? (locale === "de" ? "KI-TOOL" : "AI TOOL");
  const eyebrow = locale === "de"
    ? `${category} IM CHECK · ${year}`
    : `${category} REVIEW · ${year}`;

  // Hook: tool name as anchor + honest-review question
  const hookLead = tool.name;
  const hookHighlight = locale === "de" ? "lohnt es sich?" : "worth it?";
  const categoryLabel = tool.primaryCategory ?? (locale === "de" ? "KI-Tool" : "AI Tool");
  const subline = tool.tagline ?? (locale === "de" ? `${categoryLabel} im ehrlichen Test.` : `${categoryLabel} — honest review.`);

  const promise1 = locale === "de" ? "Stärken & Schwächen" : "Strengths & weaknesses";
  const promise2 = locale === "de" ? "Ehrlich. Ohne Hype." : "Honest. No hype.";

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
      {/* Background gradients */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 70% at 85% 10%, color-mix(in oklch, ${theme.brand} 8%, transparent), transparent 60%),
            radial-gradient(ellipse 60% 60% at 10% 90%, color-mix(in oklch, ${theme.accent} 5%, transparent), transparent 55%)
          `,
        }}
      />

      {/* Tool logo — top right, prominent single-tool anchor */}
      <div
        style={{
          position: "absolute",
          top: SZ.PAD_Y_TOP,
          right: SZ.PAD_X,
        }}
      >
        <ToolIconImage
          {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
          {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
          hue={tool.iconHue ?? 220}
          size={88}
        />
      </div>

      {/* Ghost tool name — decorative BG anchor */}
      <div
        style={{
          position: "absolute",
          left: -20,
          bottom: 120,
          fontFamily: FONT,
          fontSize: 360,
          fontWeight: 900,
          color: theme.ink,
          opacity: themeMode === "dark" ? 0.05 : 0.03,
          lineHeight: 1,
          userSelect: "none",
          letterSpacing: "-0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {tool.name.slice(0, 6)}
      </div>

      {/* Content column */}
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrow} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />

        {/* Hook headline — tool name + honest-review question */}
        <div style={{ marginTop: 56 }}>
          <div style={{ fontFamily: FONT, fontSize: 96, fontWeight: 900, lineHeight: 1.05, color: theme.ink }}>
            {hookLead}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 80, fontWeight: 800, lineHeight: 1.1, color: theme.brand }}>
            {hookHighlight}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 400, color: theme.inkMuted, marginTop: 16, maxWidth: SZ.TEXT_SAFE_W }}>
            {subline}
          </div>
        </div>

        {/* Promise block */}
        <div style={{ marginTop: 56, display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div
            style={{
              width: 8,
              minHeight: 72,
              background: theme.brand,
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: theme.ink }}>
              {promise1}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: theme.inkMuted }}>
              {promise2}
            </div>
          </div>
        </div>

        {/* Top pros preview chips */}
        {tool.pros.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 20,
                fontWeight: 600,
                color: theme.inkMuted,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                marginBottom: 20,
              }}
            >
              {locale === "de" ? "Warum es sich lohnt" : "Why it matters"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {tool.pros.slice(0, 3).map((pro, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    background: themeMode === "dark" ? "oklch(22% 0.025 250)" : "oklch(94% 0.01 250)",
                    borderRadius: 12,
                    padding: "14px 20px",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: i === 0 ? theme.brand : theme.accent,
                      flexShrink: 0,
                      boxShadow: i === 0 ? `0 0 8px color-mix(in oklch, ${theme.brand} 60%, transparent)` : undefined,
                    }}
                  />
                  <span style={{ fontFamily: FONT, fontSize: 24, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? theme.ink : theme.inkMuted, lineHeight: 1.3 }}>
                    {pro.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: 72, left: SZ.PAD_X, right: SZ.PAD_X }}>
        <BrandFooter
          websiteUrl={websiteUrl}
          instagramHandle={instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`1/${totalSlides}`}
        />
      </div>
    </div>
  );
}
