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

export function EndSlide({ input, slideNumber }: Props) {
  const { tool, theme: themeMode, locale, websiteUrl, instagramHandle, totalSlides, articleSlug } = input;
  const theme = getThemeTokens(undefined, themeMode);

  const eyebrow = locale === "de" ? "ZUR VERTIEFUNG" : "DIVE DEEPER";

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
            {locale === "de" ? "Speichere diesen" : "Save this"}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
            <span style={{ color: theme.ink }}>{locale === "de" ? "Post" : "post"} </span>
            <span style={{ color: theme.brand, fontWeight: 900 }}>{locale === "de" ? "für später." : "for later."}</span>
          </div>
        </div>

        {/* Action cards */}
        <div style={{ marginTop: 60, display: "flex", flexDirection: "column", gap: 16 }}>
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
            <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: theme.brand, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
              {locale === "de" ? "Speichere diesen Post" : "Save this post"}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 600, color: theme.brand }}>
              {locale === "de" ? `als ${tool.name}-Cheat-Sheet` : `as your ${tool.name} cheat sheet`}
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
            <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: theme.inkMuted, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
              {locale === "de" ? "Mehr ehrliche Vergleiche" : "More honest reviews"}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: theme.brand }}>
              {instagramHandle}
            </div>
          </div>

          {/* Article URL card */}
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
              {locale === "de" ? "Vollständiger Test" : "Full review"}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 500, color: theme.ink }}>
              {websiteUrl}/{articleSlug}
            </div>
          </div>
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
            {locale === "de" ? "Im Check" : "Reviewed"}
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
