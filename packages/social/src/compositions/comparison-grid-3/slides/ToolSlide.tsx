import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import { localeCopy } from "../../_shared/family-a/helpers";
import type { FamilyATool } from "../../_shared/family-a/types";

interface ToolSlideProps {
  tool: FamilyATool;
  rank: number;
  totalTools: number;
  eyebrow: string;
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  endCta: string;
  endUrl: string;
}

// ─── Inline subcomponents ────────────────────────────────────────────────────

const ScoreBadge: React.FC<{ tokens: DsTokens; score: number; tier: "hi" | "mid" | "lo" }> = ({
  tokens,
  score,
  tier,
}) => {
  const colorByTier: Record<"hi" | "mid" | "lo", string> = {
    hi: tokens.accent[500],
    mid: tokens.brand[300],
    lo: tokens.ink.muted,
  };
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontWeight: 700,
          fontSize: 96,
          lineHeight: 0.95,
          color: colorByTier[tier],
          letterSpacing: "-0.05em",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {score}
      </span>
      <span
        style={{
          fontSize: 12,
          fontFamily: tokens.typography.fontFamilyMono,
          color: tokens.ink.muted,
          letterSpacing: "0.16em",
          textTransform: "uppercase" as const,
        }}
      >
        Score / 100
      </span>
    </div>
  );
};

const ToolHeader: React.FC<{
  tokens: DsTokens;
  tool: FamilyATool;
  rank: number;
}> = ({ tokens, tool, rank }) => {
  const accentColor = tool.primaryColor ?? tokens.brand[300];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, minWidth: 0 }}>
        <div
          style={{
            width: 112,
            height: 112,
            borderRadius: 24,
            background: tool.primaryColor ?? tokens.surface.raised,
            border: `2px solid ${tokens.border}`,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {tool.iconSvg ? (
            <div
              style={{ width: "82%", height: "82%", display: "flex" }}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset SVG
              dangerouslySetInnerHTML={{ __html: tool.iconSvg }}
            />
          ) : (
            <span
              style={{
                fontFamily: tokens.typography.fontFamily,
                fontWeight: 800,
                fontSize: 42,
                color: "#fff",
                letterSpacing: "-0.02em",
              }}
            >
              {tool.iconInitials ?? tool.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 14,
              fontWeight: 700,
              color: accentColor,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              display: "block",
              marginBottom: 6,
            }}
          >
            #{rank} · Rank
          </span>
          <h2
            style={{
              fontSize: 64,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 700,
              lineHeight: 1.0,
              letterSpacing: "-0.035em",
              margin: 0,
              color: tokens.ink.base,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tool.name}
          </h2>
          <div
            style={{
              fontSize: 18,
              fontFamily: tokens.typography.fontFamily,
              color: tokens.ink.muted,
              marginTop: 8,
              lineHeight: 1.3,
              maxWidth: 540,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical" as const,
            }}
          >
            {tool.meta}
          </div>
        </div>
      </div>
      <ScoreBadge tokens={tokens} score={tool.score} tier={tool.scoreTier} />
    </div>
  );
};

const PriceBar: React.FC<{ tokens: DsTokens; tool: FamilyATool }> = ({ tokens, tool }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      gap: 12,
      padding: "20px 26px",
      borderRadius: 18,
      background: tokens.surface.raised,
      border: `1px solid ${tokens.border}`,
    }}
  >
    {tool.pricePrefix ? (
      <span
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: 18,
          color: tokens.ink.muted,
          letterSpacing: "0.04em",
        }}
      >
        {tool.pricePrefix}
      </span>
    ) : null}
    <span
      style={{
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 700,
        fontSize: 32,
        color: tokens.ink.base,
        letterSpacing: "-0.02em",
      }}
    >
      {tool.priceAmount}
    </span>
    {tool.isWinner ? (
      <span
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderRadius: 999,
          background: `color-mix(in oklch, ${tool.primaryColor ?? tokens.brand[500]} 18%, transparent)`,
          color: tool.primaryColor ?? tokens.brand[300],
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
        }}
      >
        ★ {tool.winnerFlagText ?? "Top"}
      </span>
    ) : null}
  </div>
);

const ProConGrid: React.FC<{
  tokens: DsTokens;
  tool: FamilyATool;
  locale: "de" | "en";
}> = ({ tokens, tool, locale }) => {
  const copy = localeCopy(locale);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 22,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
            color: tokens.accent[500],
            marginBottom: 12,
          }}
        >
          ✓ {copy.prosLabel}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tool.pros.map((p, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable 2-item list
              key={i}
              style={{
                fontSize: 21,
                fontFamily: tokens.typography.fontFamily,
                color: tokens.ink.base,
                lineHeight: 1.35,
                letterSpacing: "-0.012em",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
            color: tokens.ink.muted,
            marginBottom: 12,
          }}
        >
          ✕ {copy.consLabel}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tool.cons.map((c, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable 2-item list
              key={i}
              style={{
                fontSize: 21,
                fontFamily: tokens.typography.fontFamily,
                color: tokens.ink.muted,
                lineHeight: 1.35,
                letterSpacing: "-0.012em",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Root ────────────────────────────────────────────────────────────────────

export const ToolSlide: React.FC<ToolSlideProps> = ({
  tool,
  rank,
  totalTools,
  eyebrow,
  theme,
  locale,
  brandTokens,
  slideIndex,
  slideTotal,
  endCta,
  endUrl,
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const slideNum = String(slideIndex + 1).padStart(2, "0");
  const totalNum = String(slideTotal).padStart(2, "0");
  const headerNum = locale === "de"
    ? `${rank} von ${totalTools} · Tool-Karte`
    : `${rank} of ${totalTools} · Tool card`;

  return (
    <AbsoluteFill
      style={{
        background: tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        overflow: "hidden",
      }}
    >
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner={tool.isWinner ? "top-right" : "bottom-left"}
        color="brand"
        size={760}
        inset={-200}
        alpha={tool.isWinner ? (theme === "dark" ? 32 : 20) : (theme === "dark" ? 18 : 12)}
        blur={70}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr auto",
          rowGap: 32,
        }}
      >
        <DsTop
          tokens={tokens}
          eyebrow={eyebrow}
          rightText={`${slideNum} / ${totalNum}`}
          num={headerNum}
        />

        <ToolHeader tokens={tokens} tool={tool} rank={rank} />

        <PriceBar tokens={tokens} tool={tool} />

        <ProConGrid tokens={tokens} tool={tool} locale={locale} />

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={40} />
      </div>
    </AbsoluteFill>
  );
};
