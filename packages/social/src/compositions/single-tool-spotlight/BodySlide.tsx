import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import { HeroTool } from "./shared/HeroTool";
import { VerdictLine } from "./shared/VerdictLine";
import { StatsRow } from "./shared/StatsRow";
import { BodyGrid } from "./shared/BodyGrid";
import type { SpotlightBodyProps } from "./types";

interface BodySlideProps extends SpotlightBodyProps {
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
}

export const BodySlide: React.FC<BodySlideProps> = (props) => {
  const brandTokens = useMemo(() => resolveBrandTokens(props.brandTokens), [props.brandTokens]);
  const tokens = useMemo(() => deriveDsTokens(brandTokens, props.theme), [brandTokens, props.theme]);

  const slideNum = String(props.slideIndex + 1).padStart(2, "0");
  const slideTotal = String(props.slideTotal).padStart(2, "0");

  return (
    <AbsoluteFill
      style={{
        background: tokens.surface.base,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Ambient glow — bottom-right brand radial */}
      <DsGlow
        tokens={tokens}
        theme={props.theme}
        corner="bottom-right"
        color="brand"
        size={900}
        inset={-300}
        blur={70}
        alpha={props.theme === "dark" ? 32 : 28}
      />

      {/* Content grid */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto auto auto 1fr auto",
          rowGap: 24,
        }}
      >
        {/* Row 1 — eyebrow + slide counter */}
        <DsTop
          tokens={tokens}
          eyebrow={props.eyebrow}
          rightText={`${slideNum} / ${slideTotal}`}
        />

        {/* Row 2 — tool hero: logo + name + version + optional LivePill */}
        <HeroTool
          tokens={tokens}
          logo={props.tool.logo}
          name={props.tool.name}
          version={props.tool.version}
          {...(props.tool.isLive !== undefined && { isLive: props.tool.isLive })}
        />

        {/* Row 3 — verdict quote */}
        <VerdictLine tokens={tokens} text={props.verdictQuote} />

        {/* Row 4 — score block + facts 2×2 grid */}
        <StatsRow
          tokens={tokens}
          score={props.score}
          scoreLabel={props.scoreLabel}
          facts={props.facts}
        />

        {/* Row 5 (1fr) — strengths / weaknesses columns */}
        <BodyGrid
          tokens={tokens}
          strengths={props.strengths}
          weaknesses={props.weaknesses}
          locale={props.locale}
        />

        {/* Row 6 — footer: URL lead + CTA bold */}
        <DsFoot
          tokens={tokens}
          ctaLead={props.footer.url}
          ctaBold={props.footer.ctaLine}
        />
      </div>
    </AbsoluteFill>
  );
};
