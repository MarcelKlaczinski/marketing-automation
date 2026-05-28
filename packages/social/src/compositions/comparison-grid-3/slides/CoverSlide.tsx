import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens, type DsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsGlow } from "../../../ds-components/DsGlow";
import { DsTop } from "../../../ds-components/DsTop";
import { DsBrandStamp } from "../../_shared/DsBrandStamp";
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
  /** Spec 65.15 — bottom-right brand-stamp watermark; null/undefined → no stamp. */
  logoUrl?: string | null;
}

// ─── Inline subcomponents ────────────────────────────────────────────────────

/**
 * Spec 65.17 A1 — logo-hero layout sizing.
 * Tools cluster size shrinks as count grows so the row always fits inside the
 * 968px content width (1080 canvas − 2×56 padding) with breathing room.
 *
 * Exported for unit tests (test/compositions/family-a-cover-logo.test.tsx);
 * not consumed by other compositions per `compositions/CLAUDE.md` discipline.
 */
export function logoTileSizeFor(count: number): {
  tile: number;
  gap: number;
  radius: number;
} {
  if (count <= 2) return { tile: 280, gap: 56, radius: 56 };
  if (count === 3) return { tile: 232, gap: 40, radius: 48 };
  if (count === 4) return { tile: 188, gap: 32, radius: 40 };
  return { tile: 160, gap: 22, radius: 36 };
}

/**
 * Inline tile — receives a fully resolved FamilyATool and renders the brand
 * logo (inline SVG) or a graceful text-fallback (initials + brand-color tile)
 * when no iconSvg is available. Spec 65.15 graceful-null discipline — never
 * broken-image.
 */
export const LogoTile: React.FC<{
  tokens: DsTokens;
  tool: FamilyATool;
  size: number;
  radius: number;
}> = ({ tokens, tool, size, radius }) => {
  const initials =
    tool.iconInitials ?? tool.name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border: `5px solid ${tokens.surface.base}`,
        background: tool.primaryColor ?? tokens.surface.raised,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: "0 18px 48px rgba(0,0,0,0.16)",
      }}
    >
      {tool.iconSvg ? (
        <div
          style={{
            width: "78%",
            height: "78%",
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
            fontSize: Math.round(size * 0.36),
            color: "#fff",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
};

/**
 * Spec 65.17 A2 — head-to-head VS-faceoff. Two large logos (~320px) on either
 * side of a "vs." glyph. Used by `head-to-head-vs` and `head-to-head-deep-dive`
 * which always pass exactly 2 tools to this shared CoverSlide. Renders each
 * tool's name underneath its logo as a small ink-muted label.
 */
export const ToolLogoFaceoff: React.FC<{
  tokens: DsTokens;
  tools: FamilyATool[];
  versusLabel: string;
}> = ({ tokens, tools, versusLabel }) => {
  const [toolA, toolB] = tools;
  if (!toolA || !toolB) return null;
  const tile = 320;
  const radius = 64;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 72,
      }}
    >
      <FaceoffSide tokens={tokens} tool={toolA} tile={tile} radius={radius} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minWidth: 96,
        }}
      >
        <span
          style={{
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 900,
            fontSize: 120,
            color: tokens.brand[300],
            letterSpacing: "-0.05em",
            lineHeight: 1,
            fontStyle: "italic",
          }}
        >
          {versusLabel}
        </span>
      </div>
      <FaceoffSide tokens={tokens} tool={toolB} tile={tile} radius={radius} />
    </div>
  );
};

const FaceoffSide: React.FC<{
  tokens: DsTokens;
  tool: FamilyATool;
  tile: number;
  radius: number;
}> = ({ tokens, tool, tile, radius }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 18,
      maxWidth: tile + 40,
    }}
  >
    <LogoTile tokens={tokens} tool={tool} size={tile} radius={radius} />
    <span
      style={{
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 700,
        fontSize: 32,
        color: tokens.ink.base,
        letterSpacing: "-0.025em",
        lineHeight: 1.1,
        textAlign: "center" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: tile + 24,
        whiteSpace: "nowrap" as const,
      }}
    >
      {tool.name}
    </span>
  </div>
);

/**
 * Spec 65.17 A1 — logo-hero treatment. Logos are the dominant visual element
 * (~160-280px tiles) on a single distinct row above the headline. Sizing scales
 * with count via `logoTileSizeFor`. The 2-tool case is handled by `ToolLogoFaceoff`
 * (Spec 65.17 A2) which the parent dispatches to instead of this component.
 */
export const ToolLogoRow: React.FC<{
  tokens: DsTokens;
  tools: FamilyATool[];
  caption: string;
}> = ({ tokens, tools, caption }) => {
  const { tile, gap, radius } = logoTileSizeFor(tools.length);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap,
        }}
      >
        {tools.map((tool) => (
          <LogoTile
            key={tool.slug}
            tokens={tokens}
            tool={tool}
            size={tile}
            radius={radius}
          />
        ))}
      </div>
      <span
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: 15,
          color: tokens.ink.muted,
          letterSpacing: "0.18em",
          textTransform: "uppercase" as const,
        }}
      >
        {caption}
      </span>
    </div>
  );
};

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
        fontSize: 88,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.headingWeight,
        lineHeight: 1.04,
        letterSpacing: "-0.04em",
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
        fontSize: 24,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 500,
        color: tokens.ink.muted,
        marginTop: 18,
        maxWidth: 920,
        lineHeight: 1.3,
        letterSpacing: "-0.015em",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
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
  logoUrl,
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const copy = localeCopy(locale);
  const slideNum = String(slideIndex + 1).padStart(2, "0");
  const totalNum = String(slideTotal).padStart(2, "0");
  const isFaceoff = tools.length === 2;
  const logoCaption =
    locale === "de"
      ? `${tools.length} Tools im Vergleich`
      : `${tools.length} tools compared`;

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
          gridTemplateRows: "auto 1fr auto auto auto",
          rowGap: 32,
        }}
      >
        <DsTop
          tokens={tokens}
          eyebrow={content.eyebrow}
          rightText={`${slideNum} / ${totalNum}`}
          num={content.headerNum}
        />

        {/* Spec 65.17 A1+A2 — logos are now the hero element above the headline.
            2-tool head-to-head templates dispatch to ToolLogoFaceoff. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isFaceoff ? (
            <ToolLogoFaceoff tokens={tokens} tools={tools} versusLabel={copy.versus} />
          ) : (
            <ToolLogoRow tokens={tokens} tools={tools} caption={logoCaption} />
          )}
        </div>

        <Hero
          tokens={tokens}
          lead={content.headlineLead}
          em={content.headlineEm}
          {...(content.headlineTrail !== undefined && { trail: content.headlineTrail })}
          subline={content.subline}
        />

        <SwipeIndicator tokens={tokens} text={copy.swipe} />

        <DsFoot tokens={tokens} ctaBold={endCta} ctaLead={endUrl} logoHeight={44} />
      </div>
      <DsBrandStamp logoUrl={logoUrl} />
    </AbsoluteFill>
  );
};
