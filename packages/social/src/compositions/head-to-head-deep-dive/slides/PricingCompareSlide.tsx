import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import { localeCopy } from "../../_shared/family-a/helpers";
import type { FamilyATool } from "../../_shared/family-a/types";
import type { PricingCompareContent } from "../types";

interface PricingCompareSlideProps {
  content: PricingCompareContent;
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

export const PricingCompareSlide: React.FC<PricingCompareSlideProps> = ({
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
      <DsGlow tokens={tokens} theme={theme} corner="top-right" color="brand" size={760} inset={-200} blur={70} />

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

        {/* Tool name headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", gap: 12 }}>
          <span />
          <div
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 700,
              fontSize: 24,
              color: toolAColor,
              letterSpacing: "-0.02em",
              textAlign: "center",
            }}
          >
            {toolA.name}
          </div>
          <div
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 700,
              fontSize: 24,
              color: toolBColor,
              letterSpacing: "-0.02em",
              textAlign: "center",
            }}
          >
            {toolB.name}
          </div>
        </div>

        {/* Pricing rows */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {content.rows.map((row, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable 3-item list
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 16,
                padding: "22px 0",
                borderTop: `1px solid ${tokens.border}`,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontFamily: tokens.typography.fontFamilyMono,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase" as const,
                  color: tokens.ink.muted,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: tokens.typography.fontFamily,
                  fontWeight: 600,
                  fontSize: 22,
                  color: tokens.ink.base,
                  textAlign: "center",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {row.toolA}
              </span>
              <span
                style={{
                  fontFamily: tokens.typography.fontFamily,
                  fontWeight: 600,
                  fontSize: 22,
                  color: tokens.ink.base,
                  textAlign: "center",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {row.toolB}
              </span>
            </div>
          ))}
        </div>

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={40} />
      </div>
    </AbsoluteFill>
  );
};
