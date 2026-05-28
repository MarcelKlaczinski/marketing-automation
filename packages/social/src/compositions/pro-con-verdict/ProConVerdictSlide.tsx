import React, { useMemo } from "react";
import { Check, CheckCircle2, X, XCircle, Users } from "lucide-react";
import { deriveDsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsBrandStamp } from "../_shared/DsBrandStamp";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import { ToolIconImage } from "../../shared/ToolIconImage";
import { proConVerdictOverridesSchema } from "../../templates/overrides/proConVerdict.overrides";
import type { ProConVerdictInput } from "./types";

export const ProConVerdictSlide: React.FC<ProConVerdictInput> = ({
  generated: g,
  brandTokens,
  theme,
  locale = "de",
  overrides,
  logoUrl,
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const ov = useMemo(
    () => proConVerdictOverridesSchema.parse(overrides ?? {}),
    [overrides],
  );
  const isDE = locale === "de";
  const copyProsHeader = isDE ? ov.copy.prosHeader.de : ov.copy.prosHeader.en;
  const copyConsHeader = isDE ? ov.copy.consHeader.de : ov.copy.consHeader.en;

  const isLight = theme === "light";
  const emColor = isLight ? tokens.brand[500] : tokens.brand[300];

  // Split verdict text around em span — guard against substring not found
  const verdictParts = g.verdictText.includes(g.verdictEm)
    ? g.verdictText.split(g.verdictEm)
    : [g.verdictText, ""];

  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        backgroundColor: isLight ? "oklch(99% 0.005 250)" : tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        padding: 56,
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto",
        rowGap: 28,
      }}
    >
      {/* Glow — bottom-left, brand-500, alpha 25 */}
      <DsGlow tokens={tokens} theme={theme} corner="bottom-left" color="brand" size={800} alpha={25} />

      {/* TOP BAR */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <DsTop
          tokens={tokens}
          eyebrow={g.eyebrow}
          num={g.dateLabel}
          rightText={g.slideNum}
        />
      </div>

      {/* HERO */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <h1
          style={{
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            margin: 0,
            color: tokens.ink.base,
          }}
        >
          {g.toolName}{" "}
          <span style={{ color: emColor }}>·</span>
          <br />
          <span style={{ color: emColor }}>{g.toolCategory}</span>
          {"."}
        </h1>
        <p
          style={{
            fontSize: 18,
            color: tokens.ink.muted,
            maxWidth: 880,
            lineHeight: 1.45,
            margin: "12px 0 0",
          }}
        >
          {g.subline}
        </p>
      </div>

      {/* VERDICT BODY */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr auto",
          gap: 18,
        }}
      >
        {/* PROS COLUMN */}
        <div
          style={{
            backgroundColor: `color-mix(in oklab, ${tokens.accent[500]} 5%, ${tokens.surface.raised})`,
            border: `1px solid ${tokens.border}`,
            borderLeft: `4px solid ${tokens.accent[500]}`,
            borderRadius: 18,
            padding: "22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            ...(isLight ? { boxShadow: tokens.shadows.sm } : {}),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: tokens.accent[500],
            }}
          >
            <CheckCircle2 size={18} strokeWidth={1.75} />
            {copyProsHeader}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {g.pros.map((text, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  fontSize: 15,
                  lineHeight: 1.4,
                  color: tokens.ink.base,
                }}
              >
                <div style={{ flexShrink: 0, marginTop: 3, color: tokens.accent[500] }}>
                  <Check size={16} strokeWidth={1.75} />
                </div>
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* CONS COLUMN */}
        <div
          style={{
            backgroundColor: `color-mix(in oklab, ${tokens.semantic.danger} 5%, ${tokens.surface.raised})`,
            border: `1px solid ${tokens.border}`,
            borderRight: `4px solid ${tokens.semantic.danger}`,
            borderRadius: 18,
            padding: "22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            ...(isLight ? { boxShadow: tokens.shadows.sm } : {}),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: tokens.semantic.danger,
            }}
          >
            <XCircle size={18} strokeWidth={1.75} />
            {copyConsHeader}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {g.cons.map((text, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  fontSize: 15,
                  lineHeight: 1.4,
                  color: tokens.ink.base,
                }}
              >
                <div style={{ flexShrink: 0, marginTop: 3, color: tokens.semantic.danger }}>
                  <X size={16} strokeWidth={1.75} />
                </div>
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* VERDICT STRIP — spans both columns */}
        <div
          style={{
            gridColumn: "1 / -1",
            backgroundColor: tokens.surface.raised,
            border: `1px solid color-mix(in oklab, ${tokens.brand[500]} 40%, ${tokens.border})`,
            boxShadow: isLight
              ? tokens.shadows.md
              : `0 0 40px -16px color-mix(in oklab, ${tokens.brand[500]} 45%, transparent)`,
            borderRadius: 20,
            padding: "22px 26px",
            display: "grid",
            gridTemplateColumns: "56px 1fr",
            columnGap: 18,
            rowGap: 8,
            alignItems: "center",
          }}
        >
          {/* Tool icon — spans both rows */}
          <div style={{ gridRow: "1 / span 2" }}>
            <ToolIconImage
              {...(g.iconSvg !== undefined && { iconSvg: g.iconSvg })}
              {...(g.iconInitials !== undefined && { initials: g.iconInitials })}
              hue={g.iconHue ?? 220}
              size={56}
            />
          </div>

          {/* Verdict text with em span */}
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: "-0.015em",
              color: tokens.ink.base,
            }}
          >
            &ldquo;{verdictParts[0]}
            {verdictParts[1] !== undefined && verdictParts[1] !== "" && (
              <span style={{ color: emColor }}>{g.verdictEm}</span>
            )}
            {verdictParts[1]}&rdquo;
          </div>

          {/* Recommendation tag */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              background: `color-mix(in oklab, ${tokens.brand[500]} 14%, transparent)`,
              border: `1px solid color-mix(in oklab, ${tokens.brand[500]} 35%, transparent)`,
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 12,
              fontWeight: 600,
              color: emColor,
              width: "fit-content",
            }}
          >
            <Users size={12} strokeWidth={1.75} />
            {g.recommendationTag}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <DsFoot
          tokens={tokens}
          ctaBold={g.ctaLine1}
          ctaLead={g.ctaLine2}
        />
      </div>
      <DsBrandStamp logoUrl={logoUrl} />
    </div>
  );
};
