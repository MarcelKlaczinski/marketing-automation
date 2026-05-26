import React from "react";
import { pickLocalized } from "./localized";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideLocale, EndSlideProps, SwipeUpConfig } from "./types";

const HEADLINE: Record<EndSlideLocale, string> = {
  de: "Mehr erfahren",
  en: "Read more",
};

const SUBLINE: Record<EndSlideLocale, string> = {
  de: "Vollständiger Vergleich",
  en: "Full comparison",
};

export const SwipeUpSlide: React.FC<
  EndSlideProps<{ type: "swipe-up"; config: SwipeUpConfig }>
> = ({ data, theme, locale, brandTokens }) => {
  const { config } = data;
  const headline = pickLocalized(config.customMessage, locale) ?? HEADLINE[locale];

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="top-right" glowColor="brand">
      {(tokens) => (
        <>
          {/* Arrow-up icon */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: `linear-gradient(180deg, ${tokens.brand[500]}, ${tokens.brand[700]})`,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 0 80px color-mix(in oklch, ${tokens.brand[500]} 30%, transparent)`,
            }}
          >
            <svg
              width={60}
              height={60}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>

          <div
            style={{
              fontSize: 76,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: tokens.ink.base,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: tokens.ink.muted,
              lineHeight: 1.4,
              maxWidth: 800,
            }}
          >
            {SUBLINE[locale]}
          </div>

          {/* Destination chip */}
          <div
            style={{
              marginTop: 24,
              padding: "18px 32px",
              borderRadius: 999,
              border: `2px solid ${tokens.brand[500]}`,
              background: tokens.surface.raised,
              fontSize: 32,
              fontWeight: tokens.typography.headingWeight,
              color: tokens.brand[500],
              fontFamily: tokens.typography.fontFamilyMono,
              letterSpacing: "-0.01em",
            }}
          >
            {config.destination}
          </div>
        </>
      )}
    </EndSlideBase>
  );
};
