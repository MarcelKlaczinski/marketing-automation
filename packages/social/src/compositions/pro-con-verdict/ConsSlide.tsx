import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { ProConIcon } from "./shared/ProConIcon.tsx";
import { resolveConsColor } from "./colors.ts";
import { proConVerdictOverridesSchema } from "../../templates/overrides/proConVerdict.overrides.ts";
import { getFontSize } from "../_shared/getFontSize.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

type Props = { input: ProConVerdictInput; slideNumber: number; totalSlides: number };

export function ConsSlide({ input, slideNumber, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, cons } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";
  const ov = proConVerdictOverridesSchema.parse(input.overrides ?? {});

  const eyebrowText = isDE ? ov.copy.consHeader.de : ov.copy.consHeader.en;
  const subhead = isDE ? "Das spricht dagegen" : "What speaks against it";
  const countLabel = `${cons.length} ${isDE ? "Nachteile" : "Cons"}`;

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
      {/* Cons tint background + glow */}
      <div style={{ position: "absolute", inset: 0, background: `color-mix(in oklch, ${consColor} 5%, transparent)` }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 80% 60% at 110% 110%, color-mix(in oklch, ${consColor} 14%, transparent), transparent 55%)`,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrowText} theme={{ ...theme, eyebrowColor: consColor }} fontFamily={FONT} letterSpacing="0.1em" />

        {/* Tool name + subhead header block */}
        <div style={{ marginTop: 28, marginBottom: 36 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 64,
              fontWeight: 900,
              lineHeight: 1.0,
              color: theme.ink,
              letterSpacing: "-0.02em",
            }}
          >
            {tool.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
            <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 600, color: consColor }}>
              {subhead}
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 18,
                fontWeight: 700,
                color: consColor,
                background: `color-mix(in oklch, ${consColor} 18%, transparent)`,
                border: `1px solid color-mix(in oklch, ${consColor} 35%, transparent)`,
                borderRadius: 24,
                padding: "4px 14px",
              }}
            >
              {countLabel}
            </div>
          </div>
        </div>

        {/* Cons cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {cons.map((con, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "18px 24px",
                borderRadius: 14,
                background: `color-mix(in oklch, ${consColor} ${i === 0 ? 12 : 7}%, transparent)`,
                border: `1px solid color-mix(in oklch, ${consColor} ${i === 0 ? 35 : 20}%, transparent)`,
                opacity: Math.max(0.72, 1 - i * 0.07),
              }}
            >
              <div style={{ flexShrink: 0 }}>
                <ProConIcon type="con" color={consColor} size={40} />
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: getFontSize(con, "list-item").fontSize,
                    lineHeight: getFontSize(con, "list-item").lineHeight,
                    fontWeight: i === 0 ? 700 : 500,
                    color: i === 0 ? theme.ink : theme.inkMuted,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    textOverflow: "ellipsis",
                  }}
                >
                  {con}
                </div>
              </div>
            </div>
          ))}
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
