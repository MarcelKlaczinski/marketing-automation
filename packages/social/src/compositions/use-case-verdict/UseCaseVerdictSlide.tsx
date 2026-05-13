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
const H = 1080;
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
      {/* Subtle gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 60% 50% at 90% 5%, color-mix(in oklch, ${theme.brand} 6%, transparent), transparent 55%)`,
        }}
      />

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
            marginTop: 48,
            fontFamily: FONT,
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            color: theme.ink,
            maxWidth: 900,
          }}
        >
          {verdict.useCase}
        </div>

        {/* Winner block */}
        <div
          style={{
            marginTop: 56,
            display: "flex",
            alignItems: "center",
            gap: 24,
            background: input.theme === "dark"
              ? "oklch(22% 0.02 248)"
              : "oklch(96% 0.01 250)",
            border: `2px solid color-mix(in oklch, ${theme.brand} 30%, transparent)`,
            borderRadius: 20,
            padding: "28px 36px",
          }}
        >
          <ToolIconImage
            {...(winnerTool?.iconSvg !== undefined && { iconSvg: winnerTool.iconSvg })}
            initials={winnerTool?.iconInitials ?? (winnerTool?.name.slice(0, 2).toUpperCase() ?? "??")}
            hue={winnerTool?.iconHue ?? 220}
            size={80}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: theme.brand,
              }}
            >
              {winnerLabel}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 48, fontWeight: 800, color: theme.ink }}>
              {winnerTool?.name ?? verdict.winner}
            </div>
          </div>
        </div>

        {/* Reason */}
        <div
          style={{
            marginTop: 48,
            fontFamily: FONT,
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.55,
            color: theme.inkMuted,
            maxWidth: 880,
          }}
        >
          {verdict.reason}
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
