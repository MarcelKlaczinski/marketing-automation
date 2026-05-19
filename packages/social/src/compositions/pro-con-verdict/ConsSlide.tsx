import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { ProConIcon } from "./shared/ProConIcon.tsx";
import { resolveConsColor } from "./colors.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

type Props = { input: ProConVerdictInput; slideNumber: number; totalSlides: number };

export function ConsSlide({ input, slideNumber, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, cons } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";

  const eyebrowText = isDE ? "NACHTEILE" : "CONS";
  const headerText = isDE ? "Das spricht dagegen" : "What speaks against it";

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
      {/* Subtle cons color tint on background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${consColor} 6%, transparent)`,
        }}
      />
      {/* Accent glow bottom-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 70% 50% at 110% 110%, color-mix(in oklch, ${consColor} 12%, transparent), transparent 60%)`,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrowText} theme={{ ...theme, eyebrowColor: consColor }} fontFamily={FONT} letterSpacing="0.1em" />

        {/* Header */}
        <div
          style={{
            fontFamily: FONT,
            fontSize: 72,
            fontWeight: 900,
            lineHeight: 1.05,
            color: theme.ink,
            marginTop: 32,
            marginBottom: 8,
          }}
        >
          {tool.name}
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 30,
            fontWeight: 600,
            color: consColor,
            marginBottom: 48,
          }}
        >
          {headerText}
        </div>

        {/* Cons list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {cons.map((con, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 20,
                opacity: Math.max(0.7, 1 - i * 0.06),
              }}
            >
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <ProConIcon type="con" color={consColor} size={38} />
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 28,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? theme.ink : theme.inkMuted,
                  lineHeight: 1.35,
                }}
              >
                {con}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
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
