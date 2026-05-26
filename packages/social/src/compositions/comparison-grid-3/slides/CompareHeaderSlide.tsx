import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import type { FamilyACompareHeaderContent } from "../../_shared/family-a/types";

interface CompareHeaderSlideProps {
  content: FamilyACompareHeaderContent;
  eyebrow: string;
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  endCta: string;
  endUrl: string;
}

export const CompareHeaderSlide: React.FC<CompareHeaderSlideProps> = ({
  content,
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
        corner="bottom-right"
        color="accent"
        size={760}
        inset={-200}
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
          gridTemplateRows: "auto auto 1fr auto",
          rowGap: 36,
        }}
      >
        <DsTop tokens={tokens} eyebrow={eyebrow} rightText={`${slideNum} / ${totalNum}`} />

        <div>
          {content.categoryBadge ? (
            <span
              style={{
                display: "inline-block",
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
                color: tokens.brand[300],
                background: `color-mix(in oklch, ${tokens.brand[500]} 12%, transparent)`,
                marginBottom: 28,
              }}
            >
              {content.categoryBadge}
            </span>
          ) : null}
          <h2
            style={{
              fontSize: 76,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: tokens.typography.headingWeight,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              margin: 0,
              color: tokens.ink.base,
            }}
          >
            {content.title}
          </h2>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {content.criteria.map((criterion, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable static list
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                opacity: Math.max(0.7, 1 - i * 0.06),
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: `color-mix(in oklch, ${tokens.accent[500]} 18%, transparent)`,
                  color: tokens.accent[500],
                  display: "grid",
                  placeItems: "center",
                  fontFamily: tokens.typography.fontFamilyMono,
                  fontSize: 18,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  fontSize: 30,
                  fontFamily: tokens.typography.fontFamily,
                  fontWeight: 600,
                  color: tokens.ink.base,
                  letterSpacing: "-0.015em",
                  lineHeight: 1.25,
                }}
              >
                {criterion}
              </span>
            </div>
          ))}
        </div>

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={40} />
      </div>
    </AbsoluteFill>
  );
};
