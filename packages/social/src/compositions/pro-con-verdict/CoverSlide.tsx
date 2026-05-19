import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { DiagonalSplit } from "./shared/DiagonalSplit.tsx";
import { ProConIcon } from "./shared/ProConIcon.tsx";
import { resolveProsColor, resolveConsColor } from "./colors.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

const SPLIT_H = 520;
const SPLIT_TOP = 180;

type Props = { input: ProConVerdictInput; totalSlides: number };

export function CoverSlide({ input, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, pros, cons, verdict } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const prosColor = resolveProsColor(brandTokens);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";

  const eyebrowText = isDE ? "BEWERTUNG" : "REVIEW";
  const prosLabel = isDE ? "VORTEILE" : "PROS";
  const consLabel = isDE ? "NACHTEILE" : "CONS";
  const snippetText = verdict?.snippet ?? "";

  // Show up to 3 icons per side on the cover
  const prosPreview = pros.slice(0, 3);
  const consPreview = cons.slice(0, 3);

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
      {/* Subtle base gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 90% 60% at 50% 100%, color-mix(in oklch, ${theme.brand} 6%, transparent), transparent 65%)`,
        }}
      />

      {/* ── Eyebrow ── */}
      <div style={{ position: "relative" }}>
        <Eyebrow text={eyebrowText} theme={theme} fontFamily={FONT} letterSpacing="0.1em" />
      </div>

      {/* ── Diagonal split panel ── */}
      <div
        style={{
          position: "absolute",
          top: SPLIT_TOP,
          left: 0,
          width: SZ.CANVAS_W,
          height: SPLIT_H,
          overflow: "hidden",
        }}
      >
        <DiagonalSplit prosColor={prosColor} consColor={consColor} width={SZ.CANVAS_W} height={SPLIT_H} />

        {/* Left half content (pros) */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: SZ.PAD_X,
            width: SZ.CANVAS_W * 0.42,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: prosColor,
              marginBottom: 24,
            }}
          >
            {prosLabel}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {prosPreview.map((_, i) => (
              <ProConIcon key={i} type="pro" color={prosColor} size={44} />
            ))}
          </div>
        </div>

        {/* Right half content (cons) */}
        <div
          style={{
            position: "absolute",
            top: 40,
            right: SZ.PAD_X,
            width: SZ.CANVAS_W * 0.42,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.09em",
              color: consColor,
              marginBottom: 24,
            }}
          >
            {consLabel}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-end" }}>
            {consPreview.map((_, i) => (
              <ProConIcon key={i} type="con" color={consColor} size={44} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Tool name — bridges split ── */}
      <div
        style={{
          position: "absolute",
          top: SPLIT_TOP + SPLIT_H - 20,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: `0 ${SZ.PAD_X}px`,
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontSize: 104,
            fontWeight: 900,
            lineHeight: 1.0,
            color: theme.ink,
            letterSpacing: "-0.03em",
            textAlign: "center",
          }}
        >
          {tool.name}
        </div>

        {snippetText && (
          <div
            style={{
              fontFamily: FONT,
              fontSize: 26,
              fontWeight: 400,
              fontStyle: "italic",
              color: theme.inkMuted,
              marginTop: 16,
              textAlign: "center",
              maxWidth: SZ.CANVAS_W - SZ.PAD_X * 2,
              lineHeight: 1.35,
            }}
          >
            {snippetText}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ position: "absolute", bottom: 72, left: SZ.PAD_X, right: SZ.PAD_X }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`1/${totalSlides}`}
          brandTokens={brandTokens}
        />
      </div>
    </div>
  );
}
