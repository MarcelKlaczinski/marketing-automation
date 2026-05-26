import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import type { FamilyAEndContent } from "../../_shared/family-a/types";

interface EndSlideProps {
  content: FamilyAEndContent;
  eyebrow: string;
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
}

export const EndSlide: React.FC<EndSlideProps> = ({
  content,
  eyebrow,
  theme,
  brandTokens,
  slideIndex,
  slideTotal,
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
        corner="top-left"
        color="brand"
        size={820}
        inset={-180}
        alpha={theme === "dark" ? 32 : 22}
        blur={70}
      />
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="bottom-right"
        color="accent"
        size={680}
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
          gridTemplateRows: "auto 1fr auto",
          rowGap: 36,
        }}
      >
        <DsTop tokens={tokens} eyebrow={eyebrow} rightText={`${slideNum} / ${totalNum}`} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 28,
          }}
        >
          <h1
            style={{
              fontSize: 116,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: tokens.typography.headingWeight,
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
              margin: 0,
              color: tokens.ink.base,
            }}
          >
            {content.headlineLead}
            <br />
            <span style={{ color: tokens.brand[300] }}>{content.headlineEm}</span>
          </h1>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              fontSize: 26,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 600,
              color: tokens.accent[500],
              marginTop: 12,
            }}
          >
            {content.ctaLine}
            <svg
              width={26}
              height={26}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>

        <DsFoot tokens={tokens} ctaBold={content.articleUrl} ctaLead={content.ctaLine} logoHeight={48} />
      </div>
    </AbsoluteFill>
  );
};
