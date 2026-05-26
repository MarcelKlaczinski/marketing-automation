import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import type { FamilyATool } from "../../_shared/family-a/types";
import type { UseCaseCompareContent } from "../types";

interface UseCaseCompareSlideProps {
  content: UseCaseCompareContent;
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

export const UseCaseCompareSlide: React.FC<UseCaseCompareSlideProps> = ({
  content,
  toolA,
  toolB,
  eyebrow,
  theme,
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
      <DsGlow tokens={tokens} theme={theme} corner="bottom-left" color="accent" size={700} inset={-180} blur={70} />

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

        <h2
          style={{
            fontSize: 64,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            margin: 0,
            color: tokens.ink.base,
          }}
        >
          {content.title}
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {content.rows.map((row, i) => {
            const winnerColor = row.winner === "a" ? toolAColor : toolBColor;
            const winnerName = row.winner === "a" ? toolA.name : toolB.name;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: stable list
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: "16px 22px",
                  borderRadius: 16,
                  background: `color-mix(in oklch, ${winnerColor} 12%, ${tokens.surface.raised})`,
                  border: `1px solid ${tokens.border}`,
                  opacity: Math.max(0.78, 1 - i * 0.05),
                }}
              >
                <span
                  style={{
                    fontSize: 22,
                    fontFamily: tokens.typography.fontFamily,
                    fontWeight: 600,
                    color: tokens.ink.base,
                    letterSpacing: "-0.012em",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: winnerColor,
                    color: "#fff",
                    fontFamily: tokens.typography.fontFamily,
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: "-0.01em",
                    flexShrink: 0,
                  }}
                >
                  ★ {winnerName}
                </span>
              </div>
            );
          })}
        </div>

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={40} />
      </div>
    </AbsoluteFill>
  );
};
