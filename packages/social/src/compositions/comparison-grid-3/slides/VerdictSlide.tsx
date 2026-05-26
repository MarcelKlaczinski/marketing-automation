import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "../../../brand-tokens/derive";
import { resolveBrandTokens } from "../../../lib/brand-tokens";
import { DsFoot } from "../../../ds-components/DsFoot";
import { DsTop } from "../../../ds-components/DsTop";
import { deriveTertiaryColor, localeCopy } from "../../_shared/family-a/helpers";
import type {
  FamilyATool,
  FamilyAVerdictContent,
} from "../../_shared/family-a/types";

interface VerdictSlideProps {
  content: FamilyAVerdictContent;
  tools: FamilyATool[];
  theme: "dark" | "light";
  locale: "de" | "en";
  brandTokens?: unknown;
  slideIndex: number;
  slideTotal: number;
  endUrl: string;
}

export const VerdictSlide: React.FC<VerdictSlideProps> = ({
  content,
  tools,
  theme,
  locale,
  brandTokens,
  slideIndex,
  slideTotal,
  endUrl,
}) => {
  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );
  const copy = localeCopy(locale);

  const winner = tools.find((t) => t.slug === content.winnerToolSlug) ?? tools[0];
  if (!winner) {
    // Defensive — schema requires tools.length === 3, so this is unreachable in practice.
    return <AbsoluteFill style={{ background: tokens.surface.base }} />;
  }

  const winnerPrimary = winner.primaryColor ?? tokens.brand[500];
  const winnerSecondary = winner.secondaryColor ?? tokens.brand[300];
  const textContrast = winner.tertiaryColor ?? deriveTertiaryColor(winnerPrimary, theme);

  const slideNum = String(slideIndex + 1).padStart(2, "0");
  const totalNum = String(slideTotal).padStart(2, "0");

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${winnerPrimary} 0%, ${winnerSecondary} 100%)`,
        color: "#fff",
        fontFamily: tokens.typography.fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Subtle DS top-row + footer overlay using surface tokens for legibility */}
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
          color: "#fff",
        }}
      >
        <DsTop
          tokens={{ ...tokens, ink: { ...tokens.ink, base: "#fff", muted: `color-mix(in oklch, #fff 70%, transparent)` } }}
          eyebrow={content.eyebrow}
          rightText={`${slideNum} / ${totalNum}`}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 24,
          }}
        >
          <span
            style={{
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              color: `color-mix(in oklch, #fff 78%, transparent)`,
            }}
          >
            {copy.andTheWinnerIs}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 36,
                background: "#fff",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 14px 40px rgba(0,0,0,0.20)",
              }}
            >
              {winner.iconSvg ? (
                <div
                  style={{ width: "78%", height: "78%", display: "flex" }}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset SVG
                  dangerouslySetInnerHTML={{ __html: winner.iconSvg }}
                />
              ) : (
                <span
                  style={{
                    fontFamily: tokens.typography.fontFamily,
                    fontWeight: 800,
                    fontSize: 64,
                    color: winnerPrimary,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {winner.iconInitials ?? winner.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <h1
              style={{
                fontSize: 96,
                fontFamily: tokens.typography.fontFamily,
                fontWeight: 800,
                lineHeight: 1.0,
                letterSpacing: "-0.04em",
                margin: 0,
                color: "#fff",
              }}
            >
              {winner.name}
            </h1>
          </div>

          <p
            style={{
              fontSize: 30,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 500,
              lineHeight: 1.32,
              letterSpacing: "-0.012em",
              margin: 0,
              maxWidth: 900,
              color: textContrast,
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {content.reasoning}
          </p>
        </div>

        <DsFoot
          tokens={{ ...tokens, ink: { ...tokens.ink, base: "#fff", muted: `color-mix(in oklch, #fff 70%, transparent)` } }}
          ctaBold={content.ctaLine}
          ctaLead={endUrl}
          logoHeight={42}
        />
      </div>
    </AbsoluteFill>
  );
};
