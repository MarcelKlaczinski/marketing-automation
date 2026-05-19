import React, { useMemo } from "react";
import { Award, Check, X } from "lucide-react";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import { ToolIconImage } from "../../shared/ToolIconImage";
import type { ComparisonGrid3Input } from "./types";

type Grid3Tool = ComparisonGrid3Input["generated"]["tools"][number];

// ─── Slide component ──────────────────────────────────────────────────────────

export const ComparisonGrid3Slide: React.FC<ComparisonGrid3Input> = ({
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
      {/* Glow — BOTTOM-LEFT, 25% alpha (grid-3; grid-4 uses top-right, 28%) */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="bottom-left"
        color="brand"
        size={800}
        inset={-240}
        alpha={25}
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
          rowGap: 28, // 28px — grid-4 uses 32px
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
              fontSize: 18, // 18px — grid-4 uses 19px
              color: tokens.ink.muted,
              marginTop: 18,
              marginBottom: 0,
              maxWidth: 920, // 920px — grid-4 uses 880px
              lineHeight: 1.4,
            }}
          >
            {g.subline}
          </p>
        </div>

        {/* STACK — 3 auto-height cards (grid-4 uses fixed 150px) */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "repeat(3, auto)",
            gap: 14,
            alignContent: "start",
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
  tool: Grid3Tool;
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

  const border = tool.isWinner
    ? `1px solid color-mix(in oklch, ${tokens.accent[500]} 65%, transparent)`
    : `1px solid ${tokens.border}`;

  const boxShadow = tool.isWinner
    ? `0 0 0 1px ${tokens.accent[500]}, 0 0 60px -10px color-mix(in oklch, ${tokens.accent[500]} 50%, transparent)`
    : isLight
      ? tokens.shadows.sm
      : "none";

  return (
    <div
      style={{
        backgroundColor: tokens.surface.raised,
        border,
        boxShadow,
        borderRadius: 18,
        padding: "18px 22px", // 18/22 — grid-4 uses 20/26
        display: "grid",
        gridTemplateColumns: "72px 1fr auto",
        gridTemplateRows: "auto auto", // TWO rows — grid-4 has one
        alignItems: "center",
        columnGap: 18, // 18px — grid-4 uses 28px
        rowGap: 10,
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* Winner flag — LEFT-anchored (grid-4 is right: 28px) */}
      {tool.isWinner && tool.winnerFlagText && (
        <div
          style={{
            position: "absolute",
            top: -14,
            left: 32,
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

      {/* ROW 1 — Logo */}
      <div style={{ width: 72, height: 72, borderRadius: 18, overflow: "hidden", flexShrink: 0 }}>
        <ToolIconImage
          {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
          {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
          hue={tool.iconHue ?? 220}
          size={72}
        />
      </div>

      {/* ROW 1 — Head: name + meta */}
      <div style={{ minWidth: 0 }}>
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
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 12,
            color: tokens.ink.muted,
            marginTop: 6,
          }}
        >
          {tool.meta}
        </div>
      </div>

      {/* ROW 1 — Score + Price */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          minWidth: 170, // 170px — grid-4 uses 150px
        }}
      >
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontWeight: 700,
            fontSize: 56, // 56px — grid-4 uses 84px
            letterSpacing: "-0.055em",
            lineHeight: 0.85,
            fontFeatureSettings: '"tnum"',
            color: scoreColor,
          }}
        >
          {tool.score}
        </div>
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 13,
            color: tokens.ink.muted,
          }}
        >
          {tool.pricePrefix && (
            <span>{tool.pricePrefix} </span>
          )}
          <strong style={{ color: tokens.ink.base, fontWeight: 600 }}>
            {tool.priceAmount}
          </strong>
        </div>
      </div>

      {/* ROW 2 — Bullets: spans all 3 columns */}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 22px",
          borderTop: `1px solid ${tokens.border}`,
          paddingTop: 12,
        }}
      >
        {tool.pros.map((text, i) => (
          <Bullet key={`pro-${i}`} text={text} isPro tokens={tokens} />
        ))}
        {tool.cons.map((text, i) => (
          <Bullet key={`con-${i}`} text={text} isPro={false} tokens={tokens} />
        ))}
      </div>
    </div>
  );
};

// ─── Bullet ───────────────────────────────────────────────────────────────────

interface BulletProps {
  text: string;
  isPro: boolean;
  tokens: DsTokens;
}

const Bullet: React.FC<BulletProps> = ({ text, isPro, tokens }) => (
  <div
    style={{
      display: "flex",
      gap: 8,
      alignItems: "flex-start",
      fontSize: 13,
      lineHeight: 1.35,
      color: tokens.ink.muted,
    }}
  >
    <div
      style={{
        flexShrink: 0,
        marginTop: 2,
        color: isPro ? tokens.accent[500] : tokens.semantic.danger,
      }}
    >
      {isPro
        ? <Check size={14} strokeWidth={1.75} />
        : <X size={14} strokeWidth={1.75} />
      }
    </div>
    {text}
  </div>
);
