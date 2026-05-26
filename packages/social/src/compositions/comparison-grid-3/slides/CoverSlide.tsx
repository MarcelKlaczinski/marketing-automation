import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import { localeCopy } from "../../_shared/family-a/helpers";
import type {
  FamilyACoverContent,
  FamilyATool,
} from "../../_shared/family-a/types";

interface CoverSlideProps {
  content: FamilyACoverContent;
  tools: FamilyATool[];
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  endCta: string;
  endUrl: string;
}

// ─── Inline subcomponents ────────────────────────────────────────────────────

const Hero: React.FC<{ tokens: DsTokens; lead: string; em: string; trail?: string; subline: string }> = ({
  tokens,
  lead,
  em,
  trail,
  subline,
}) => (
  <div>
    <h1
      style={{
        fontSize: 108,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.headingWeight,
        lineHeight: 1.02,
        letterSpacing: "-0.045em",
        margin: 0,
        color: tokens.ink.base,
        overflow: "hidden",
      }}
    >
      {lead}{" "}
      <span style={{ color: tokens.brand[300] }}>{em}</span>
      {trail ? <>{trail}</> : null}
    </h1>
    <div
      style={{
        fontSize: 26,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 500,
        color: tokens.ink.muted,
        marginTop: 22,
        maxWidth: 920,
        lineHeight: 1.3,
        letterSpacing: "-0.015em",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {subline}
      </div>
    </div>
  </div>
);

const ToolLogos: React.FC<{ tokens: DsTokens; tools: FamilyATool[]; moreText: string }> = ({
  tokens,
  tools,
  moreText,
}) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    {tools.map((tool, i) => (
      <div
        key={tool.slug}
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          border: `4px solid ${tokens.surface.base}`,
          marginLeft: i === 0 ? 0 : -22,
          background: tool.primaryColor ?? tokens.surface.raised,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {tool.iconSvg ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset SVG
            dangerouslySetInnerHTML={{ __html: tool.iconSvg }}
          />
        ) : (
          <span
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 800,
              fontSize: 26,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            {tool.iconInitials ?? tool.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
    ))}
    <span
      style={{
        marginLeft: 12,
        fontFamily: tokens.typography.fontFamilyMono,
        fontSize: 15,
        color: tokens.ink.muted,
        letterSpacing: "0.06em",
        textTransform: "uppercase" as const,
      }}
    >
      {moreText}
    </span>
  </div>
);

const SwipeIndicator: React.FC<{ tokens: DsTokens; text: string }> = ({ tokens, text }) => (
  <div
    style={{
      justifySelf: "end",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      fontSize: 18,
      fontFamily: tokens.typography.fontFamily,
      fontWeight: 600,
      color: tokens.accent[500],
    }}
  >
    {text}
    <svg
      width={22}
      height={22}
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
);

// ─── Root ────────────────────────────────────────────────────────────────────

export const CoverSlide: React.FC<CoverSlideProps> = ({
  content,
  tools,
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
  const moreText = locale === "de" ? `${tools.length} im Vergleich` : `${tools.length} compared`;

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
        corner="top-right"
        color="brand"
        size={900}
        inset={{ x: -220, y: -140 }}
        alpha={theme === "dark" ? 42 : 28}
        blur={70}
      />
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="bottom-left"
        color="accent"
        size={700}
        inset={-200}
        alpha={theme === "dark" ? 22 : 16}
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
          gridTemplateRows: "auto auto 1fr auto auto auto",
          rowGap: 28,
        }}
      >
        <DsTop
          tokens={tokens}
          eyebrow={content.eyebrow}
          rightText={`${slideNum} / ${totalNum}`}
          num={content.headerNum}
        />

        <Hero
          tokens={tokens}
          lead={content.headlineLead}
          em={content.headlineEm}
          {...(content.headlineTrail !== undefined && { trail: content.headlineTrail })}
          subline={content.subline}
        />

        <ToolLogos tokens={tokens} tools={tools} moreText={moreText} />

        <SwipeIndicator tokens={tokens} text={copy.swipe} />

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={44} />
      </div>
    </AbsoluteFill>
  );
};
