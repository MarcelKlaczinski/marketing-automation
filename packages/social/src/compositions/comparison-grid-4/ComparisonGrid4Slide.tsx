import React, { useMemo } from "react";
import { Award } from "lucide-react";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import { ToolIconImage } from "../../shared/ToolIconImage";
import type { ComparisonGrid4Input } from "./types";

type Grid4Tool = ComparisonGrid4Input["generated"]["tools"][number];

// ─── Slide component ──────────────────────────────────────────────────────────

export const ComparisonGrid4Slide: React.FC<ComparisonGrid4Input> = ({
  generated: g,
  brandTokens,
  theme = "dark",
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const isLight = theme === "light";

  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        backgroundColor: isLight ? "oklch(99% 0.005 250)" : tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Glow — TOP-RIGHT (comparison-grid-4 specific; spotlight uses bottom-left) */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="top-right"
        color="brand"
        size={800}
        inset={-240}
        alpha={28}
        blur={50}
      />

      {/* Content layer above glow */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          rowGap: 32, // 32px — differs from spotlight (28px)
        }}
      >
        {/* TOP BAR */}
        <DsTop
          tokens={tokens}
          eyebrow={g.eyebrow}
          num={g.dateLabel}
          rightText={g.slideNum}
        />

        {/* HERO */}
        <div>
          <h1
            style={{
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              margin: 0,
              color: tokens.ink.base,
            }}
          >
            {g.headline}{" "}
            <span style={{ color: tokens.brand[300] }}>{g.headlineEm}</span>
          </h1>
          <p
            style={{
              fontSize: 19, // 19px — differs from grid-3 (18px)
              color: tokens.ink.muted,
              marginTop: 18,
              marginBottom: 0,
              maxWidth: 880,
              lineHeight: 1.4,
            }}
          >
            {g.subline}
          </p>
        </div>

        {/* STACK — 4 fixed-height tool cards */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "repeat(4, 150px)", // fixed 150px rows
            gap: 14,
          }}
        >
          {g.tools.map((tool, i) => (
            <ToolCard key={i} tool={tool} tokens={tokens} isLight={isLight} />
          ))}
        </div>

        {/* FOOTER */}
        <DsFoot
          tokens={tokens}
          ctaLead={g.ctaLine2}
          ctaBold={g.ctaLine1}
        />
      </div>
    </div>
  );
};

// ─── ToolCard ─────────────────────────────────────────────────────────────────

interface ToolCardProps {
  tool: Grid4Tool;
  tokens: DsTokens;
  isLight: boolean;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, tokens, isLight }) => {
  const scoreColor =
    tool.scoreTier === "hi"
      ? tokens.accent[500]
      : tool.scoreTier === "mid"
        ? tokens.semantic.warn
        : tokens.semantic.danger;

  const winnerBorder = tool.isWinner
    ? `1px solid color-mix(in oklch, ${tokens.accent[500]} 65%, transparent)`
    : `1px solid ${tokens.border}`;

  const winnerShadow = tool.isWinner
    ? `0 0 0 1px ${tokens.accent[500]}, 0 0 60px -10px color-mix(in oklch, ${tokens.accent[500]} 50%, transparent)`
    : isLight
      ? tokens.shadows.sm
      : "none";

  return (
    <div
      style={{
        backgroundColor: tokens.surface.raised,
        border: winnerBorder,
        boxShadow: winnerShadow,
        borderRadius: 18,
        padding: "20px 26px",
        display: "grid",
        gridTemplateColumns: "72px 1fr auto",
        alignItems: "center",
        columnGap: 28, // 28px — differs from grid-3 (18px)
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* Winner flag — RIGHT-anchored (grid-3 is left-anchored) */}
      {tool.isWinner && tool.winnerFlagText && (
        <div
          style={{
            position: "absolute",
            top: -14,
            right: 28, // right-anchored
            backgroundColor: tokens.accent[500],
            color: "#06291f",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 999,
            display: "inline-flex",
            whiteSpace: "nowrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Award size={14} strokeWidth={1.75} />
          {tool.winnerFlagText}
        </div>
      )}

      {/* Logo */}
      <div style={{ width: 72, height: 72, borderRadius: 18, overflow: "hidden", flexShrink: 0 }}>
        <ToolIconImage
          {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
          {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
          hue={tool.iconHue ?? 220}
          size={72}
        />
      </div>

      {/* Mid — name + verdict */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1,
            color: tokens.ink.base,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tool.name}
        </div>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.35,
            color: tokens.ink.muted,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          } as React.CSSProperties}
        >
          <strong style={{ color: tokens.ink.base, fontWeight: 600 }}>
            {tool.verdictStrong}
          </strong>
          {" "}
          {tool.verdictRest}
        </div>
      </div>

      {/* Right — score + price */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          minWidth: 150,
        }}
      >
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontWeight: 700,
            fontSize: 84, // 84px — differs from grid-3 (56px)
            letterSpacing: "-0.055em",
            lineHeight: 0.9,
            fontFeatureSettings: '"tnum"',
            color: scoreColor,
          }}
        >
          {tool.score}
        </div>
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 16,
            color: tokens.ink.muted,
            fontWeight: 500,
          }}
        >
          {tool.priceLabel}
        </div>
      </div>
    </div>
  );
};
