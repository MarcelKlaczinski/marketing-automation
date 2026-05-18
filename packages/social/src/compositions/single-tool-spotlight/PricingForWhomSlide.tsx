import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { PricingChip } from "../../shared/PricingChip.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import type { SingleToolSpotlightInput } from "./types.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";

type Props = { input: SingleToolSpotlightInput; slideNumber: number };

export function PricingForWhomSlide({ input, slideNumber }: Props) {
  const { tool, theme: themeMode, locale, brandTokens, totalSlides } = input;
  const theme = getThemeTokens(undefined, themeMode);

  const eyebrow = locale === "de" ? "PRICING & FÜR WEN" : "PRICING & FOR WHOM";
  const forWhomLabel = locale === "de" ? "Perfekt für" : "Perfect for";
  const notForLabel = locale === "de" ? "Weniger geeignet wenn…" : "Skip if…";

  const pricingTier = (tool.pricingTier === "enterprise" ? "paid" : (tool.pricingTier ?? "freemium")) as "free" | "freemium" | "paid";
  const pricingLabel = tool.pricingTier === "free"
    ? (locale === "de" ? "Kostenlos" : "Free")
    : tool.pricingTier === "paid"
      ? (tool.priceFrom ? (locale === "de" ? `ab ${tool.priceFrom}€/Monat` : `from $${tool.priceFrom}/month`) : (locale === "de" ? "Kostenpflichtig" : "Paid"))
      : (tool.priceFrom ? (locale === "de" ? `Freemium · Pro ab ${tool.priceFrom}€/Monat` : `Freemium · Pro from $${tool.priceFrom}/month`) : "Freemium");

  const useCasesToShow = tool.useCases.length >= 3 ? tool.useCases.slice(0, 2) : tool.useCases;

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
          background: `
            radial-gradient(ellipse 70% 40% at 100% 0%, color-mix(in oklch, ${theme.accent} 7%, transparent), transparent 55%),
            radial-gradient(ellipse 60% 50% at 0% 100%, color-mix(in oklch, ${theme.brand} 8%, transparent), transparent 55%)
          `,
        }}
      />

      {/* Tool logo — top right, consistent with other slides */}
      <div style={{ position: "absolute", top: SZ.PAD_Y_TOP, right: SZ.PAD_X }}>
        <ToolIconImage
          {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
          {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
          hue={tool.iconHue ?? 220}
          size={64}
        />
      </div>

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow text={eyebrow} theme={theme} fontFamily={FONT} letterSpacing="0.08em" />

        <div style={{ fontFamily: FONT, fontSize: 72, fontWeight: 800, color: theme.ink, lineHeight: 1.1, marginTop: 36 }}>
          {tool.name}
        </div>

        {/* Pricing block */}
        <div
          style={{
            marginTop: 48,
            padding: "32px 36px",
            borderRadius: 20,
            background: themeMode === "dark" ? "oklch(18% 0.025 250)" : "oklch(96% 0.01 250)",
            border: `1px solid color-mix(in oklch, ${theme.brand} 25%, transparent)`,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 700,
              color: theme.inkMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
            }}
          >
            {locale === "de" ? "Pricing" : "Pricing"}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div
              style={{
                padding: "4px",
                border: `2px solid color-mix(in oklch, ${theme.brand} 25%, transparent)`,
                borderRadius: 16,
              }}
            >
              <PricingChip tier={pricingTier} label={pricingLabel} fontFamily={FONT} theme={themeMode} />
            </div>
          </div>
          {tool.priceFrom !== undefined && tool.pricingTier !== "free" && (
            <div style={{ fontFamily: FONT, fontSize: 24, color: theme.inkMuted }}>
              {locale === "de"
                ? `Free-Plan verfügbar${tool.pricingTier === "freemium" ? ` · Pro-Features ab €${tool.priceFrom}/Monat` : ""}`
                : `Free plan available${tool.pricingTier === "freemium" ? ` · Pro from $${tool.priceFrom}/month` : ""}`
              }
            </div>
          )}
        </div>

        {/* For-whom block */}
        {useCasesToShow.length > 0 && (
          <div
            style={{
              marginTop: 36,
              padding: "28px 36px",
              borderRadius: 20,
              background: `color-mix(in oklch, ${theme.brand} 10%, transparent)`,
              borderLeft: `6px solid ${theme.brand}`,
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
                marginBottom: 16,
              }}
            >
              {forWhomLabel}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {useCasesToShow.map((uc, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: theme.brand,
                      flexShrink: 0,
                      marginTop: 11,
                      boxShadow: `0 0 6px color-mix(in oklch, ${theme.brand} 50%, transparent)`,
                    }}
                  />
                  <span style={{ fontFamily: FONT, fontSize: 28, fontWeight: 600, color: theme.ink, lineHeight: 1.3 }}>
                    {uc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cons as "Skip if" — shown when no use-case slide follows */}
        {tool.useCases.length < 3 && tool.cons.length > 0 && (
          <div
            style={{
              marginTop: 28,
              padding: "22px 28px",
              borderRadius: 14,
              background: themeMode === "dark" ? "oklch(20% 0.02 10)" : "oklch(96% 0.01 10)",
              borderLeft: `4px solid color-mix(in oklch, ${theme.inkMuted} 35%, transparent)`,
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
                marginBottom: 12,
              }}
            >
              {notForLabel}
            </div>
            {tool.cons.slice(0, 2).map((con, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: i > 0 ? 8 : 0 }}>
                <span style={{ color: theme.inkMuted, fontSize: 22, flexShrink: 0 }}>–</span>
                <span style={{ fontFamily: FONT, fontSize: 24, color: theme.inkMuted, lineHeight: 1.3 }}>
                  {con.text}
                </span>
              </div>
            ))}
          </div>
        )}
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
