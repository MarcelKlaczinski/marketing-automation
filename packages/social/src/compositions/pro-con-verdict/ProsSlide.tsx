import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { ProConIcon } from "./shared/ProConIcon.tsx";
import { resolveProsColor } from "./colors.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

type Props = { input: ProConVerdictInput; slideNumber: number; totalSlides: number };

export function ProsSlide({ input, slideNumber, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, pros } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const prosColor = resolveProsColor(brandTokens);
  const isDE = locale === "de";

  const eyebrowText = isDE ? "VORTEILE" : "PROS";
  const headerText = isDE ? "Das spricht dafür" : "What speaks for it";

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
      {/* Subtle pros color tint on background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${prosColor} 6%, transparent)`,
        }}
      />
      {/* Accent glow bottom-left */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 70% 50% at -10% 110%, color-mix(in oklch, ${prosColor} 12%, transparent), transparent 60%)`,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrowText} theme={{ ...theme, eyebrowColor: prosColor }} fontFamily={FONT} letterSpacing="0.1em" />

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
            color: prosColor,
            marginBottom: 48,
          }}
        >
          {headerText}
        </div>

        {/* Pros list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {pros.map((pro, i) => (
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
                <ProConIcon type="pro" color={prosColor} size={38} />
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
                {pro}
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
