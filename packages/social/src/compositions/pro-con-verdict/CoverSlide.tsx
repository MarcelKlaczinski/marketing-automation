import React from "react";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import { CAROUSEL_SAFE_ZONES as SZ } from "../list-carousel/safeZones.ts";
import { DiagonalSplit } from "./shared/DiagonalSplit.tsx";
import { ProConIcon } from "./shared/ProConIcon.tsx";
import { resolveProsColor, resolveConsColor } from "./colors.ts";
import { proConVerdictOverridesSchema } from "../../templates/overrides/proConVerdict.overrides.ts";
import type { ProConVerdictInput } from "./types.ts";

const FONT = "Space Grotesk, sans-serif";

// Split panel spans from below eyebrow to ~80% of canvas height
const SPLIT_TOP = 155;
const SPLIT_H = 700;

// Safe content zones inside each split half (stay inside the diagonal safe area).
// Left: x=PAD_X → x≈480 (≈44% canvas width, safe even at split bottom)
// Right: x≈660 → x=CANVAS_W-PAD_X (≈38% canvas width from right, safe at all y)
const LEFT_MAX_W = 400;
const RIGHT_MAX_W = 340;
const RIGHT_START_X = SZ.CANVAS_W - SZ.PAD_X - RIGHT_MAX_W;

type Props = { input: ProConVerdictInput; totalSlides: number };

export function CoverSlide({ input, totalSlides }: Props) {
  const { theme: themeMode, locale, brandTokens, tool, pros, cons, verdict } = input;
  const theme = getThemeTokens(brandTokens, themeMode);
  const prosColor = resolveProsColor(brandTokens);
  const consColor = resolveConsColor(brandTokens);
  const isDE = locale === "de";
  const ov = proConVerdictOverridesSchema.parse(input.overrides ?? {});

  const eyebrowText = isDE ? ov.copy.coverEyebrow.de : ov.copy.coverEyebrow.en;
  const prosLabel = isDE ? ov.copy.prosHeader.de : ov.copy.prosHeader.en;
  const consLabel = isDE ? ov.copy.consHeader.de : ov.copy.consHeader.en;
  const prosCount = `${pros.length} ${isDE ? "Vorteile" : "Pros"}`;
  const consCount = `${cons.length} ${isDE ? "Nachteile" : "Cons"}`;

  // Truncate first item to fit in column
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + "…" : s;
  const firstPro = truncate(pros[0] ?? "", 52);
  const firstCon = truncate(cons[0] ?? "", 52);

  const snippetText = verdict?.snippet ?? "";

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
      {/* Base gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 80% 50% at 50% 110%, color-mix(in oklch, ${theme.brand} 6%, transparent), transparent 60%)`,
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
        <DiagonalSplit prosColor={prosColor} consColor={consColor} width={SZ.CANVAS_W} height={SPLIT_H} strokeColor={theme.inkMuted} />

        {/* ── Left half: Pros ── */}
        <div
          style={{
            position: "absolute",
            top: 44,
            left: SZ.PAD_X,
            width: LEFT_MAX_W,
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {/* Label */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "0.10em",
              color: prosColor,
              marginBottom: 22,
            }}
          >
            {prosLabel}
          </div>

          {/* Icons */}
          <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
            {pros.slice(0, Math.min(pros.length, 5)).map((_, i) => (
              <ProConIcon key={i} type="pro" color={prosColor} size={48} />
            ))}
          </div>

          {/* Count */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 36,
              fontWeight: 900,
              color: prosColor,
              lineHeight: 1,
              marginBottom: 18,
            }}
          >
            {prosCount}
          </div>

          {/* First pro teaser */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 23,
              fontWeight: 500,
              color: theme.inkMuted,
              lineHeight: 1.35,
            }}
          >
            {firstPro}
          </div>
        </div>

        {/* ── Right half: Cons ── */}
        <div
          style={{
            position: "absolute",
            top: 44,
            left: RIGHT_START_X,
            width: RIGHT_MAX_W,
            display: "flex",
            flexDirection: "column",
            gap: 0,
            alignItems: "flex-end",
          }}
        >
          {/* Label */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "0.10em",
              color: consColor,
              marginBottom: 22,
              textAlign: "right",
            }}
          >
            {consLabel}
          </div>

          {/* Icons */}
          <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
            {cons.slice(0, Math.min(cons.length, 4)).map((_, i) => (
              <ProConIcon key={i} type="con" color={consColor} size={48} />
            ))}
          </div>

          {/* Count */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 36,
              fontWeight: 900,
              color: consColor,
              lineHeight: 1,
              marginBottom: 18,
              textAlign: "right",
            }}
          >
            {consCount}
          </div>

          {/* First con teaser */}
          <div
            style={{
              fontFamily: FONT,
              fontSize: 23,
              fontWeight: 500,
              color: theme.inkMuted,
              lineHeight: 1.35,
              textAlign: "right",
            }}
          >
            {firstCon}
          </div>
        </div>
      </div>

      {/* ── Tool name — overlaps split bottom edge ── */}
      <div
        style={{
          position: "absolute",
          top: SPLIT_TOP + SPLIT_H - 48,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: `0 ${SZ.PAD_X}px`,
        }}
      >
        {/* Ghost name behind for depth */}
        <div
          style={{
            position: "absolute",
            top: -8,
            fontFamily: FONT,
            fontSize: 180,
            fontWeight: 900,
            color: theme.ink,
            opacity: themeMode === "dark" ? 0.04 : 0.025,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            whiteSpace: "nowrap",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {tool.name.slice(0, 7)}
        </div>

        <div
          style={{
            fontFamily: FONT,
            fontSize: 100,
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
              fontSize: 25,
              fontWeight: 400,
              fontStyle: "italic",
              color: theme.inkMuted,
              marginTop: 14,
              textAlign: "center",
              maxWidth: SZ.CANVAS_W - SZ.PAD_X * 2,
              lineHeight: 1.4,
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
