/**
 * Spec 65.17 B2 — Single-still slide for `tool-tier-ranking`.
 *
 * Layout (1080×1350):
 *   DsTop (eyebrow + headerNum)
 *   Hero (lead + em + optional subline)
 *   3 stacked TierLanes (spitze → stark → solide) — 1fr
 *   DsFoot (ctaLine + articleUrl)
 *   DsBrandStamp watermark
 *
 * Tier lanes use semantic gold/silver/bronze tokens from `./tier-colors.ts`
 * (Spec 65.17 B3). Tool logos within each lane reuse the inline `LogoTile`
 * pattern from `comparison-grid-3/slides/CoverSlide.tsx` for visual
 * consistency with the rest of Family-A.
 */
import React, { useMemo } from "react";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsFoot } from "../../ds-components/DsFoot";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsBrandStamp } from "../_shared/DsBrandStamp";
import { LogoTile } from "../comparison-grid-3/slides/CoverSlide";
import type { FamilyATool } from "../_shared/family-a/types";
import { getTierColors, type TierColorTokens } from "./tier-colors";
import type { TierLane, ToolTierRankingInput } from "./types";

export const ToolTierRankingSlide: React.FC<ToolTierRankingInput> = ({
  generated: g,
  brandTokens,
  theme = "dark",
  locale = "de",
  logoUrl,
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        backgroundColor: tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Spitze-tinted glow top-right — links the gold tier to the global lighting. */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="top-right"
        color="brand"
        size={800}
        inset={{ x: -200, y: -160 }}
        alpha={theme === "dark" ? 32 : 22}
        blur={70}
      />
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="bottom-left"
        color="accent"
        size={600}
        inset={-180}
        alpha={theme === "dark" ? 18 : 14}
        blur={60}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          paddingTop: 104,
          paddingRight: 56,
          paddingBottom: 56,
          paddingLeft: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          rowGap: 28,
        }}
      >
        <DsTop tokens={tokens} eyebrow={g.eyebrow} num={g.headerNum} rightText="" />

        <Hero
          tokens={tokens}
          lead={g.headlineLead}
          em={g.headlineEm}
          {...(g.subline !== undefined && { subline: g.subline })}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
          }}
        >
          {g.tiers.map((lane) => (
            <TierLaneRow key={lane.tier} lane={lane} tokens={tokens} theme={theme} locale={locale} />
          ))}
        </div>

        <DsFoot tokens={tokens} ctaBold={g.ctaLine} ctaLead={g.articleUrl} logoHeight={44} />
      </div>
      <DsBrandStamp logoUrl={logoUrl} />
    </div>
  );
};

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero: React.FC<{
  tokens: DsTokens;
  lead: string;
  em: string;
  subline?: string;
}> = ({ tokens, lead, em, subline }) => (
  <div>
    <h1
      style={{
        fontSize: 76,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.headingWeight,
        lineHeight: 1.04,
        letterSpacing: "-0.04em",
        margin: 0,
        color: tokens.ink.base,
        overflow: "hidden",
      }}
    >
      {lead}{" "}
      <span style={{ color: tokens.brand[300] }}>{em}</span>
    </h1>
    {subline ? (
      <div
        style={{
          fontSize: 20,
          fontFamily: tokens.typography.fontFamily,
          fontWeight: 500,
          color: tokens.ink.muted,
          marginTop: 14,
          maxWidth: 900,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {subline}
      </div>
    ) : null}
  </div>
);

// ─── TierLaneRow ─────────────────────────────────────────────────────────────

const TierLaneRow: React.FC<{
  lane: TierLane;
  tokens: DsTokens;
  theme: "dark" | "light";
  locale: "de" | "en";
}> = ({ lane, tokens, theme }) => {
  const tier = getTierColors(theme, lane.tier);
  const tile = lane.tools.length === 1 ? 132 : 116;
  const radius = lane.tools.length === 1 ? 28 : 24;
  return (
    <div
      style={{
        position: "relative",
        background: tier.surface,
        borderRadius: 28,
        border: `1px solid ${tier.border}`,
        padding: "22px 28px",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        gap: 28,
        overflow: "hidden",
      }}
    >
      {/* Accent strip — left edge */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          background: tier.border,
        }}
      />
      <TierBadge tier={tier} label={lane.label} count={lane.tools.length} mono={tokens.typography.fontFamilyMono} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        {lane.tools.map((t) => (
          <ToolChip key={t.slug} tokens={tokens} tool={t} tile={tile} radius={radius} />
        ))}
      </div>
    </div>
  );
};

const TierBadge: React.FC<{
  tier: TierColorTokens;
  label: string;
  count: number;
  mono: string;
}> = ({ tier, label, count, mono }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 4,
      minWidth: 140,
      marginLeft: 8,
    }}
  >
    <span
      style={{
        fontSize: 40,
        fontWeight: 800,
        letterSpacing: "-0.03em",
        color: tier.text,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: mono,
        fontSize: 13,
        letterSpacing: "0.16em",
        textTransform: "uppercase" as const,
        color: tier.text,
        opacity: 0.78,
      }}
    >
      {`${count} · ${count === 1 ? "Tool" : "Tools"}`}
    </span>
  </div>
);

const ToolChip: React.FC<{
  tokens: DsTokens;
  tool: FamilyATool;
  tile: number;
  radius: number;
}> = ({ tokens, tool, tile, radius }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      maxWidth: 360,
    }}
  >
    <LogoTile tokens={tokens} tool={tool} size={tile} radius={radius} />
    <span
      style={{
        fontFamily: tokens.typography.fontFamily,
        fontSize: tile === 132 ? 28 : 24,
        fontWeight: 700,
        color: tokens.ink.base,
        letterSpacing: "-0.02em",
        lineHeight: 1.1,
        whiteSpace: "nowrap" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 220,
      }}
    >
      {tool.name}
    </span>
  </div>
);
