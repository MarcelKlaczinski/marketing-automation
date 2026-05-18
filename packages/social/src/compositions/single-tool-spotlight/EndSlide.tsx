import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import type { SingleToolSpotlightInput } from "./types.ts";
import { singleToolSpotlightOverridesSchema } from "../../templates/overrides/singleToolSpotlight.overrides.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";
const DEFAULT_OVERRIDES = singleToolSpotlightOverridesSchema.parse({});

type Props = { input: SingleToolSpotlightInput; slideNumber: number };

export function EndSlide({ input, slideNumber }: Props) {
  const { tool, theme: themeMode, locale, brandTokens, totalSlides, articleSlug } = input;
  const theme = getThemeTokens(undefined, themeMode);
  const isDE = locale === "de";

  const overrides = input.overrides ?? DEFAULT_OVERRIDES;
  const copy = overrides.copy.endSlide;
  const layout = overrides.layout;

  const eyebrow = isDE ? "ZUR VERTIEFUNG" : "DIVE DEEPER";
  const ctaSaveLabel = isDE ? copy.ctaSaveLabel.de : copy.ctaSaveLabel.en;
  const ctaSaveSubline = isDE
    ? `als ${tool.name}-Cheat-Sheet`
    : `as your ${tool.name} cheat sheet`;
  const ctaFollowLabel = isDE ? copy.ctaFollowLabel.de : copy.ctaFollowLabel.en;
  const reviewedLabel = isDE ? "Im Check" : "Reviewed";

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
      {/* Aurora background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 80% 60% at 50% 110%, color-mix(in oklch, ${theme.brand} 18%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 60% 50% at 90% 10%, color-mix(in oklch, ${theme.accent} 8%, transparent) 0%, transparent 55%)
          `,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrow} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />

        {/* CTA headline */}
        <div style={{ marginTop: 52 }}>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, lineHeight: 1.1, color: theme.ink }}>
            {isDE ? "Speichere diesen" : "Save this"}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
            <span style={{ color: theme.ink }}>{isDE ? "Post" : "post"} </span>
            <span style={{ color: theme.brand, fontWeight: 900 }}>{isDE ? "für später." : "for later."}</span>
          </div>
        </div>

        {/* Action cards */}
        <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Save card */}
          {layout.showSavePrompt && (
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
              <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: theme.brand, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
                {ctaSaveLabel}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: theme.brand }}>
                {ctaSaveSubline}
              </div>
            </div>
          )}

          {/* Follow card */}
          {layout.showFollowCTA && (
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
              <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: theme.inkMuted, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
                {ctaFollowLabel}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: theme.brand }}>
                {brandTokens.social.instagramHandle}
              </div>
            </div>
          )}

          {/* Article URL card */}
          {layout.showArticleLink && (
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
              <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: theme.inkMuted, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
                {isDE ? "Vollständiger Test" : "Full review"}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 500, color: theme.ink }}>
                {brandTokens.social.websiteUrl}/{articleSlug}
              </div>
            </div>
          )}
        </div>

        {/* Tool recap */}
        <div
          style={{
            marginTop: 40,
            padding: "24px 28px",
            borderRadius: 16,
            background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
            border: `1px solid color-mix(in oklch, ${theme.inkMuted} 15%, transparent)`,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 16,
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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ToolIconImage
              {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
              {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
              hue={tool.iconHue ?? 220}
              size={44}
            />
            <span style={{ fontFamily: FONT, fontSize: 28, fontWeight: 800, color: theme.ink }}>
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
        />
      </div>
    </div>
  );
}
