import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../brand-tokens/derive";
import { resolveBrandTokens } from "../../lib/brand-tokens";
import { DsBrandStamp } from "../_shared/DsBrandStamp";
import { DsGlow } from "../../ds-components/DsGlow";
import { DsTop } from "../../ds-components/DsTop";
import { DsFoot } from "../../ds-components/DsFoot";
import type { CoverProps } from "./types";

interface CoverSlideProps {
  content: CoverProps;
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  /** Spec 65.15 — bottom-right brand-stamp watermark. */
  logoUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Inline subcomponents — each ~20–30 lines, internal to CoverSlide only
// ---------------------------------------------------------------------------

interface HeroProps {
  tokens: DsTokens;
  title: string;      // may contain "<br>" and "<em>…</em>"
  kicker: string;
}

function parseHeroTitle(title: string, brandColor: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = title;
  let key = 0;

  while (remaining.length > 0) {
    const brIdx = remaining.indexOf("<br>");
    const emStart = remaining.indexOf("<em>");

    if (brIdx === -1 && emStart === -1) { parts.push(remaining); break; }

    const nextBr = brIdx === -1 ? Infinity : brIdx;
    const nextEm = emStart === -1 ? Infinity : emStart;

    if (nextBr <= nextEm) {
      if (brIdx > 0) parts.push(remaining.slice(0, brIdx));
      parts.push(<br key={key++} />);
      remaining = remaining.slice(brIdx + 4);
    } else {
      if (emStart > 0) parts.push(remaining.slice(0, emStart));
      remaining = remaining.slice(emStart + 4);
      const emEnd = remaining.indexOf("</em>");
      if (emEnd === -1) { parts.push(remaining); break; }
      parts.push(
        <span key={key++} style={{ color: brandColor }}>{remaining.slice(0, emEnd)}</span>,
      );
      remaining = remaining.slice(emEnd + 5);
    }
  }
  return parts;
}

const Hero: React.FC<HeroProps> = ({ tokens, title, kicker }) => (
  <div>
    <h1
      style={{
        fontSize: 120,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.headingWeight,
        lineHeight: 1.0,
        letterSpacing: "-0.045em",
        margin: 0,
        color: tokens.ink.base,
        overflow: "hidden",
      }}
    >
      {parseHeroTitle(title, tokens.brand[300])}
    </h1>
    <div
      style={{
        fontSize: 24,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 500,
        color: tokens.ink.muted,
        marginTop: 18,
        maxWidth: 920,
        lineHeight: 1.25,
        letterSpacing: "-0.02em",
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
        {kicker}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------

interface ToolLogosProps {
  tokens: DsTokens;
  logos: Array<{ src: string; alt: string }>;
  moreText: string;
}

const ToolLogos: React.FC<ToolLogosProps> = ({ tokens, logos, moreText }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    {logos.map((logo, i) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: stable static list
        key={i}
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          border: `4px solid ${tokens.surface.base}`,
          marginLeft: i === 0 ? 0 : -22,
          background: tokens.surface.raised,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {/* SVG inline for tool logos from ToolContext */}
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 800,
            color: tokens.ink.base,
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset SVGs
          dangerouslySetInnerHTML={{ __html: logo.src.startsWith("<svg") ? logo.src : `<span>${logo.alt.slice(0, 2).toUpperCase()}</span>` }}
        />
      </div>
    ))}
    <span
      style={{
        marginLeft: 8,
        fontFamily: tokens.typography.fontFamilyMono,
        fontSize: 14,
        color: tokens.ink.muted,
        letterSpacing: "0.06em",
      }}
    >
      {moreText}
    </span>
  </div>
);

// ---------------------------------------------------------------------------

interface CoverStatsProps {
  tokens: DsTokens;
  stats: Array<{ value: string; label: string }>;
}

function parseStatValue(value: string, brandColor: string): React.ReactNode[] {
  // Support <em>…</em> for accent-colored suffix (e.g. "50<em>k</em>")
  const parts: React.ReactNode[] = [];
  let remaining = value;
  let key = 0;
  while (remaining.length > 0) {
    const emStart = remaining.indexOf("<em>");
    if (emStart === -1) { parts.push(remaining); break; }
    if (emStart > 0) parts.push(remaining.slice(0, emStart));
    remaining = remaining.slice(emStart + 4);
    const emEnd = remaining.indexOf("</em>");
    if (emEnd === -1) { parts.push(remaining); break; }
    parts.push(<span key={key++} style={{ color: brandColor }}>{remaining.slice(0, emEnd)}</span>);
    remaining = remaining.slice(emEnd + 5);
  }
  return parts;
}

const CoverStats: React.FC<CoverStatsProps> = ({ tokens, stats }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      background: tokens.surface.raised,
      border: `1px solid ${tokens.border}`,
      borderRadius: 18,
      padding: "22px 26px",
      alignSelf: "end",
    }}
  >
    {stats.map((col, i) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: stable 3-item list
        key={i}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          borderLeft: i > 0 ? `1px solid ${tokens.border}` : undefined,
          paddingLeft: i > 0 ? 28 : undefined,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontWeight: 700,
            fontSize: 48,
            letterSpacing: "-0.055em",
            lineHeight: 0.9,
            color: tokens.ink.base,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {parseStatValue(col.value, tokens.brand[300])}
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: tokens.typography.fontFamily,
            letterSpacing: "0.14em",
            textTransform: "uppercase" as const,
            fontWeight: 600,
            color: tokens.ink.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {col.label}
        </span>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------

interface BylineProps {
  tokens: DsTokens;
  byline: { initials: string; name: string; role: string; readTime: string };
}

const Byline: React.FC<BylineProps> = ({ tokens, byline }) => (
  <div
    style={{
      display: "flex",
      gap: 14,
      alignItems: "center",
      fontFamily: tokens.typography.fontFamilyMono,
      fontSize: 13,
      color: tokens.ink.muted,
    }}
  >
    {/* Author avatar */}
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${tokens.brand[500]}, ${tokens.brand[900]})`,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 700,
        fontSize: 14,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {byline.initials}
    </div>

    <span style={{ color: tokens.ink.base, fontFamily: tokens.typography.fontFamily, fontWeight: 600 }}>
      {byline.name}
    </span>

    <span style={{ width: 4, height: 4, borderRadius: "50%", background: tokens.ink.muted, flexShrink: 0 }} />

    <span>{byline.role}</span>

    <span style={{ width: 4, height: 4, borderRadius: "50%", background: tokens.ink.muted, flexShrink: 0 }} />

    <span>{byline.readTime}</span>
  </div>
);

// ---------------------------------------------------------------------------

interface SwipeIndicatorProps {
  tokens: DsTokens;
  text: string;
}

const SwipeIndicator: React.FC<SwipeIndicatorProps> = ({ tokens, text }) => (
  <div
    style={{
      alignSelf: "end",
      justifySelf: "end",
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      fontSize: 17,
      fontFamily: tokens.typography.fontFamily,
      fontWeight: 600,
      color: tokens.accent[500],
    }}
  >
    {text}
    {/* Arrow right — inline SVG, no Lucide dependency in Remotion */}
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  </div>
);

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export const CoverSlide: React.FC<CoverSlideProps> = ({
  content,
  theme,
  brandTokens,
  slideIndex,
  slideTotal,
  logoUrl,
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
      {/* Dual glow — brand top-right + accent bottom-left (per cover-dark.html) */}
      <DsGlow
        tokens={tokens}
        theme={theme}
        corner="top-right"
        color="brand"
        size={880}
        inset={{ x: -200, y: -120 }}
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

      {/* 7-row content grid matching cover-dark.html structure */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          padding: 56,
          boxSizing: "border-box",
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr auto auto auto",
          rowGap: 20,
        }}
      >
        {/* Row 1 — eyebrow + update badge (or slide counter) */}
        <DsTop
          tokens={tokens}
          eyebrow={content.eyebrow}
          rightText={`${slideNum} / ${totalNum}`}
          num={content.headerNum}
          {...(content.updateBadge !== undefined && { updateBadge: content.updateBadge })}
        />

        {/* Row 2 — hero title + kicker */}
        <Hero tokens={tokens} title={content.heroTitle} kicker={content.kicker} />

        {/* Row 3 — tool logo cluster */}
        <ToolLogos tokens={tokens} logos={content.toolLogos} moreText={content.toolsMoreText} />

        {/* Row 4 (1fr) — stats block pinned to bottom of available space */}
        <CoverStats tokens={tokens} stats={content.stats} />

        {/* Row 5 — author byline */}
        <Byline tokens={tokens} byline={content.byline} />

        {/* Row 6 — swipe indicator (right-aligned) */}
        <SwipeIndicator tokens={tokens} text={content.swipeText} />

        {/* Row 7 — footer */}
        <DsFoot
          tokens={tokens}
          ctaLead={content.footer.url}
          ctaBold={content.footer.ctaLine}
          logoHeight={48}
        />
      </div>
      <DsBrandStamp logoUrl={logoUrl} />
    </AbsoluteFill>
  );
};
