import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsTop } from "../../../ds-components/DsTop";
import { localeCopy } from "../../_shared/family-a/helpers";
import type { FamilyATool } from "../../_shared/family-a/types";
import type { HeadToHeadCompareSlideContent } from "../types";

interface SideBySideSlideProps {
  content: HeadToHeadCompareSlideContent;
  toolA: FamilyATool;
  toolB: FamilyATool;
  eyebrow: string;
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  endCta: string;
  endUrl: string;
}

interface ToolColumnProps {
  tokens: DsTokens;
  tool: FamilyATool;
  side: "left" | "right";
}

const ToolColumn: React.FC<ToolColumnProps> = ({ tokens, tool, side }) => {
  const accent = tool.primaryColor ?? (side === "left" ? tokens.brand[300] : tokens.accent[500]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flex: 1 }}>
      <div
        style={{
          width: 92,
          height: 92,
          borderRadius: 20,
          background: tool.primaryColor ?? tokens.surface.raised,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {tool.iconSvg ? (
          <div
            style={{ width: "80%", height: "80%", display: "flex" }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset
            dangerouslySetInnerHTML={{ __html: tool.iconSvg }}
          />
        ) : (
          <span style={{ fontFamily: tokens.typography.fontFamily, fontWeight: 800, fontSize: 36, color: "#fff" }}>
            {tool.iconInitials ?? tool.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: tokens.typography.fontFamily,
          fontWeight: 700,
          fontSize: 30,
          color: tokens.ink.base,
          letterSpacing: "-0.025em",
          textAlign: "center",
        }}
      >
        {tool.name}
      </span>
      <span
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          color: accent,
        }}
      >
        {side === "left" ? "Tool A" : "Tool B"}
      </span>
    </div>
  );
};

interface CompareRowProps {
  tokens: DsTokens;
  label: string;
  toolAVerdict: string;
  toolBVerdict: string;
  winner: "a" | "b" | "tie";
  toolAColor: string;
  toolBColor: string;
}

const CompareRow: React.FC<CompareRowProps> = ({
  tokens,
  label,
  toolAVerdict,
  toolBVerdict,
  winner,
  toolAColor,
  toolBColor,
}) => {
  const aWins = winner === "a";
  const bWins = winner === "b";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 18,
        padding: "18px 0",
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          fontSize: 19,
          fontFamily: tokens.typography.fontFamily,
          color: aWins ? toolAColor : tokens.ink.base,
          fontWeight: aWins ? 700 : 500,
          textAlign: "right",
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
        }}
      >
        {toolAVerdict}
      </div>
      <span
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase" as const,
          color: tokens.ink.muted,
          textAlign: "center",
          minWidth: 130,
          padding: "6px 12px",
          borderRadius: 999,
          background: tokens.surface.raised,
          border: `1px solid ${tokens.border}`,
        }}
      >
        {label}
      </span>
      <div
        style={{
          fontSize: 19,
          fontFamily: tokens.typography.fontFamily,
          color: bWins ? toolBColor : tokens.ink.base,
          fontWeight: bWins ? 700 : 500,
          textAlign: "left",
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
        }}
      >
        {toolBVerdict}
      </div>
    </div>
  );
};

export const SideBySideSlide: React.FC<SideBySideSlideProps> = ({
  content,
  toolA,
  toolB,
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
  const copy = localeCopy(locale);
  const slideNum = String(slideIndex + 1).padStart(2, "0");
  const totalNum = String(slideTotal).padStart(2, "0");

  const toolAColor = toolA.primaryColor ?? tokens.brand[300];
  const toolBColor = toolB.primaryColor ?? tokens.accent[500];

  return (
    <AbsoluteFill
      style={{
        background: tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          rowGap: 28,
        }}
      >
        <DsTop tokens={tokens} eyebrow={eyebrow} rightText={`${slideNum} / ${totalNum}`} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 36 }}>
          <ToolColumn tokens={tokens} tool={toolA} side="left" />
          <div
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 800,
              fontSize: 48,
              color: tokens.ink.muted,
              letterSpacing: "-0.04em",
            }}
          >
            {copy.versus}
          </div>
          <ToolColumn tokens={tokens} tool={toolB} side="right" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {content.criteria.map((c, i) => (
            <CompareRow
              // biome-ignore lint/suspicious/noArrayIndexKey: stable 3-item list
              key={i}
              tokens={tokens}
              label={c.label}
              toolAVerdict={c.toolAVerdict}
              toolBVerdict={c.toolBVerdict}
              winner={c.winner}
              toolAColor={toolAColor}
              toolBColor={toolBColor}
            />
          ))}
        </div>

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={40} />
      </div>
    </AbsoluteFill>
  );
};
