import React from "react";
import { pickLocalized } from "./localized";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideLocale, EndSlideProps, SaveShareConfig } from "./types";

const SECONDARY_LABEL: Record<EndSlideLocale, { save: string; share: string }> = {
  de: { save: "Teilen", share: "Speichern" },
  en: { save: "Share", share: "Save" },
};

interface IconProps {
  size: number;
  stroke: string;
  fill?: string;
}

const SaveIcon: React.FC<IconProps> = ({ size, stroke, fill = "none" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const ShareIcon: React.FC<IconProps> = ({ size, stroke, fill = "none" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx={18} cy={5} r={3} />
    <circle cx={6} cy={12} r={3} />
    <circle cx={18} cy={19} r={3} />
    <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
  </svg>
);

export const SaveShareSlide: React.FC<
  EndSlideProps<{ type: "save-share-cta"; config: SaveShareConfig }>
> = ({ data, theme, locale, brandTokens }) => {
  const { config } = data;
  const isSave = config.primaryAction === "save";
  const secondary = isSave ? SECONDARY_LABEL[locale].save : SECONDARY_LABEL[locale].share;
  const message = pickLocalized(config.message, locale) ?? "";

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="bottom-left" glowColor="brand">
      {(tokens) => (
        <>
          {/* Primary action icon — large, brand-tinted */}
          <div
            style={{
              width: 144,
              height: 144,
              borderRadius: 36,
              background: `linear-gradient(135deg, ${tokens.brand[500]}, ${tokens.brand[700]})`,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 0 80px color-mix(in oklch, ${tokens.brand[500]} 32%, transparent)`,
            }}
          >
            {isSave ? <SaveIcon size={72} stroke="white" /> : <ShareIcon size={72} stroke="white" />}
          </div>

          <div
            style={{
              fontSize: 76,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: tokens.ink.base,
              maxWidth: 880,
            }}
          >
            {message}
          </div>

          {/* Secondary action chip — smaller, muted */}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 28px",
              borderRadius: 999,
              border: `1.5px solid ${tokens.border}`,
              background: tokens.surface.raised,
              color: tokens.ink.muted,
              fontSize: 26,
              fontWeight: 500,
            }}
          >
            {isSave ? (
              <ShareIcon size={28} stroke={tokens.ink.muted} />
            ) : (
              <SaveIcon size={28} stroke={tokens.ink.muted} />
            )}
            <span>{secondary}</span>
          </div>
        </>
      )}
    </EndSlideBase>
  );
};
