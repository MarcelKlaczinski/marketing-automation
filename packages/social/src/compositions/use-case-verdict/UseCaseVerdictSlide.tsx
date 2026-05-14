import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import type { UseCaseVerdictInput, UseCaseVerdictItem, UseCaseVerdictTool } from "./types.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";
const W = 1080;
const H = 1350;
const PAD_X = 80;
const PAD_Y = 100;
const FOOTER_BOTTOM = 72;

type Props = {
  input: UseCaseVerdictInput;
  verdict: UseCaseVerdictItem;
  /** 1-based index of this verdict within the verdicts array */
  verdictIndex: number;
  slideIndex: number;
  totalSlides: number;
};

export function UseCaseVerdictSlide({
  input,
  verdict,
  verdictIndex,
  slideIndex,
  totalSlides,
}: Props) {
  const theme = getThemeTokens(undefined, input.theme);
  const winnerTool = input.tools.find((t) => t.slug === verdict.winner);

  const eyebrowText =
    input.locale === "de"
      ? `USE-CASE ${String(verdictIndex).padStart(2, "0")}/${String(input.verdicts.length).padStart(2, "0")}`
      : `USE CASE ${String(verdictIndex).padStart(2, "0")}/${String(input.verdicts.length).padStart(2, "0")}`;

  const winnerLabel = input.locale === "de" ? "GEWINNT" : "WINS";

  const winnerInitials =
    winnerTool?.iconInitials ?? (winnerTool?.name.slice(0, 2).toUpperCase() ?? "??");

  return (
    <div
      style={{
        width: W,
        height: H,
        background: theme.bg,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: `${PAD_Y}px ${PAD_X}px`,
        paddingBottom: 140,
        boxSizing: "border-box",
      }}
    >
      {/* Dual-source gradient — brand top-right + accent bottom-left */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 55% at 95% 0%, color-mix(in oklch, ${theme.brand} 10%, transparent), transparent 55%),
            radial-gradient(ellipse 60% 50% at 5% 100%, color-mix(in oklch, ${theme.accent} 6%, transparent), transparent 55%)
          `,
        }}
      />

      {/* Ghost initial of the winning tool — decorative, bottom-right */}
      <div
        style={{
          position: "absolute",
          right: -20,
          bottom: 100,
          fontFamily: FONT,
          fontSize: 480,
          fontWeight: 900,
          color: theme.ink,
          opacity: input.theme === "dark" ? 0.05 : 0.03,
          lineHeight: 1,
          userSelect: "none",
          letterSpacing: "-0.05em",
        }}
      >
        {winnerInitials}
      </div>

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow
          text={eyebrowText}
          theme={theme}
          fontFamily={FONT}
          letterSpacing="0.08em"
        />

        {/* Use-case title */}
        <div
          style={{
            marginTop: 52,
            fontFamily: FONT,
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            color: theme.ink,
            maxWidth: 880,
          }}
        >
          {verdict.useCase}
        </div>

        {/* Winner block — more prominent */}
        <div
          style={{
            marginTop: 72,
            display: "flex",
            alignItems: "center",
            gap: 28,
            background: input.theme === "dark"
              ? "oklch(22% 0.025 248)"
              : "oklch(96% 0.01 250)",
            border: `2px solid color-mix(in oklch, ${theme.brand} 35%, transparent)`,
            borderRadius: 24,
            padding: "36px 48px",
            boxShadow: `0 8px 48px color-mix(in oklch, ${theme.brand} 12%, transparent)`,
          }}
        >
          <ToolIconImage
            {...(winnerTool?.iconSvg !== undefined && { iconSvg: winnerTool.iconSvg })}
            initials={winnerInitials}
            hue={winnerTool?.iconHue ?? 220}
            size={96}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: theme.brand,
              }}
            >
              {winnerLabel}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 56, fontWeight: 800, color: theme.ink, lineHeight: 1.05 }}>
              {winnerTool?.name ?? verdict.winner}
            </div>
          </div>
        </div>

        {/* Reason — styled with left accent bar */}
        <div
          style={{
            marginTop: 56,
            display: "flex",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: 5,
              alignSelf: "stretch",
              minHeight: 40,
              background: `linear-gradient(180deg, ${theme.brand}, color-mix(in oklch, ${theme.brand} 30%, transparent))`,
              borderRadius: 3,
              flexShrink: 0,
              marginTop: 4,
            }}
          />
          <div
            style={{
              fontFamily: FONT,
              fontSize: 34,
              fontWeight: 400,
              lineHeight: 1.55,
              color: theme.inkMuted,
              maxWidth: 840,
            }}
          >
            {verdict.reason}
          </div>
        </div>

        {/* Progress dots */}
        <div
          style={{
            marginTop: 64,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          {Array.from({ length: input.verdicts.length }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === verdictIndex - 1 ? 28 : 10,
                height: 10,
                borderRadius: 5,
                background: i === verdictIndex - 1
                  ? theme.brand
                  : `color-mix(in oklch, ${theme.inkMuted} 30%, transparent)`,
                transition: "width 0.2s",
              }}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: FOOTER_BOTTOM, left: PAD_X, right: PAD_X }}>
        <BrandFooter
          websiteUrl={input.websiteUrl}
          instagramHandle={input.instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`${slideIndex + 1}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
