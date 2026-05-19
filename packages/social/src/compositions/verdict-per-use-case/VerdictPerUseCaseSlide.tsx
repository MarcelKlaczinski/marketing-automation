import React, { useMemo } from "react";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import { ToolIconImage } from "../../shared/ToolIconImage";
import type { VerdictPerUseCaseInput, VerdictUseCase } from "./types";

export const VerdictPerUseCaseSlide: React.FC<VerdictPerUseCaseInput> = ({
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
        // Light mode: no card backgrounds in this template, so no shadows needed
        backgroundColor: isLight ? "oklch(99% 0.005 250)" : tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Glow — TOP-LEFT, accent-500 color, alpha 22. Both deltas vs all other templates. */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="top-left"
        color="accent"
        size={800}
        inset={-240}
        alpha={22}
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
          rowGap: 28,
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
            {/* accent-500 here — NOT brand-300 like all other templates (Pattern 89) */}
            <span style={{ color: tokens.accent[500] }}>{g.headlineEm}</span>
          </h1>
          <p
            style={{
              fontSize: 17,          // 17px — smallest across all templates (grid-3=18, grid-4=19)
              color: tokens.ink.muted,
              marginTop: 16,         // 16px — others use 18px
              marginBottom: 0,
              maxWidth: 880,
              lineHeight: 1.4,
            }}
          >
            {g.subline}
          </p>
        </div>

        {/* USE CASE LIST — flex column, fills 1fr */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {g.useCases.map((uc, i) => (
            <UseCaseRow
              key={i}
              uc={uc}
              index={i + 1}
              isLast={i === g.useCases.length - 1}
              tokens={tokens}
            />
          ))}
        </div>

        {/* FOOTER */}
        <DsFoot
          tokens={tokens}
          ctaBold={g.ctaLine1}
          ctaLead={g.ctaLine2}
        />
      </div>
    </div>
  );
};

// ─── UseCaseRow ───────────────────────────────────────────────────────────────

interface UseCaseRowProps {
  uc: VerdictUseCase;
  index: number;
  isLast: boolean;
  tokens: DsTokens;
}

const UseCaseRow: React.FC<UseCaseRowProps> = ({ uc, index, isLast, tokens }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "48px 1fr auto",
      alignItems: "center",
      gap: 16,
      padding: "12px 0",
      borderTop: `1px solid ${tokens.border}`,
      // Pattern 90: border-bottom only on last row — never CSS :last-child (Remotion no pseudo-selectors)
      ...(isLast ? { borderBottom: `1px solid ${tokens.border}` } : {}),
    }}
  >
    {/* Index — zero-padded monospace */}
    <div
      style={{
        fontFamily: tokens.typography.fontFamilyMono,
        fontSize: 14,
        color: tokens.ink.muted,
        fontFeatureSettings: '"tnum"',
      }}
    >
      {String(index).padStart(2, "0")}
    </div>

    {/* Label */}
    <div
      style={{
        fontSize: 22,
        fontWeight: 600,
        lineHeight: 1.15,
        letterSpacing: "-0.02em",
        color: tokens.ink.base,
      }}
    >
      {uc.label}
    </div>

    {/* Winner pill — accent tint background + border, all accent-500 derived */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px 8px 10px",  // asymmetric: less left (icon), more right (text)
        background: `color-mix(in oklch, ${tokens.accent[500]} 14%, transparent)`,
        border: `1px solid color-mix(in oklch, ${tokens.accent[500]} 45%, transparent)`,
        borderRadius: 999,
        flexShrink: 0,
      }}
    >
      <ToolIconImage
        {...(uc.iconSvg !== undefined && { iconSvg: uc.iconSvg })}
        {...(uc.iconInitials !== undefined && { initials: uc.iconInitials })}
        hue={uc.iconHue ?? 220}
        size={36}
      />
      {/* Pattern 91: white-space: nowrap mandatory — tool names up to 22 chars must not wrap */}
      <span
        style={{
          fontWeight: 700,
          fontSize: 17,
          letterSpacing: "-0.01em",
          color: tokens.accent[500],
          whiteSpace: "nowrap",
        }}
      >
        {uc.winnerName}
      </span>
    </div>
  </div>
);
