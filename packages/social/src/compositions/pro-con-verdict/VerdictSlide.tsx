import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { resolveProsColor, resolveConsColor } from "./colors.ts";
import { proConVerdictOverridesSchema } from "../../templates/overrides/proConVerdict.overrides.ts";
import { getFontSize } from "../_shared/getFontSize.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

type Props = { input: ProConVerdictInput; slideNumber: number; totalSlides: number };

export function VerdictSlide({ input, slideNumber, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, verdict } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const prosColor = resolveProsColor(brandTokens);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";
  const ov = proConVerdictOverridesSchema.parse(input.overrides ?? {});

  const eyebrowText = isDE ? ov.copy.verdictEyebrow.de : ov.copy.verdictEyebrow.en;
  const whenToUseLabel = isDE ? ov.copy.whenToUseLabel.de : ov.copy.whenToUseLabel.en;
  const whenToSkipLabel = isDE ? ov.copy.whenToSkipLabel.de : ov.copy.whenToSkipLabel.en;

  const whenToUse = verdict?.whenToUse ?? "";
  const whenToSkip = verdict?.whenToSkip ?? "";
  const whenToUseBucket = getFontSize(whenToUse, "slot-body");
  const whenToSkipBucket = getFontSize(whenToSkip, "slot-body");

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
      {/* Dual-color glow (mirrors cover split language) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 60% 50% at -10% 60%, color-mix(in oklch, ${prosColor} 8%, transparent), transparent 55%),
            radial-gradient(ellipse 60% 50% at 110% 60%, color-mix(in oklch, ${consColor} 8%, transparent), transparent 55%)
          `,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrowText} theme={theme} fontFamily={FONT} letterSpacing="0.1em" />

        {/* Tool name */}
        <div
          style={{
            fontFamily: FONT,
            fontSize: 60,
            fontWeight: 900,
            color: theme.ink,
            marginTop: 28,
            marginBottom: 44,
            letterSpacing: "-0.02em",
          }}
        >
          {tool.name}
        </div>

        {/* When-to-use section */}
        <div
          style={{
            marginBottom: 28,
            padding: "28px 32px",
            borderRadius: 16,
            background: `color-mix(in oklch, ${prosColor} 8%, transparent)`,
            border: `1.5px solid color-mix(in oklch, ${prosColor} 30%, transparent)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.09em",
              color: prosColor,
              marginBottom: 12,
            }}
          >
            {whenToUseLabel}
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `color-mix(in oklch, ${prosColor} 25%, transparent)`,
              marginBottom: 16,
            }}
          />
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: whenToUseBucket.fontSize,
                lineHeight: whenToUseBucket.lineHeight,
                fontWeight: 500,
                color: theme.ink,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textOverflow: "ellipsis",
              }}
            >
              {whenToUse}
            </div>
          </div>
        </div>

        {/* When-to-skip section */}
        <div
          style={{
            padding: "28px 32px",
            borderRadius: 16,
            background: `color-mix(in oklch, ${consColor} 8%, transparent)`,
            border: `1.5px solid color-mix(in oklch, ${consColor} 30%, transparent)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.09em",
              color: consColor,
              marginBottom: 12,
            }}
          >
            {whenToSkipLabel}
          </div>
          <div
            style={{
              width: "100%",
              height: 1,
              background: `color-mix(in oklch, ${consColor} 25%, transparent)`,
              marginBottom: 16,
            }}
          />
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: whenToSkipBucket.fontSize,
                lineHeight: whenToSkipBucket.lineHeight,
                fontWeight: 500,
                color: theme.ink,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                textOverflow: "ellipsis",
              }}
            >
              {whenToSkip}
            </div>
          </div>
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
