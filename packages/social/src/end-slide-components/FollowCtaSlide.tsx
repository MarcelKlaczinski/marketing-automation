import React from "react";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideLocale, EndSlideProps, FollowCtaConfig } from "./types";

const HEADLINE: Record<EndSlideLocale, string> = {
  de: "Folge für mehr",
  en: "Follow for more",
};

const SUBLINE: Record<EndSlideLocale, string> = {
  de: "KI-Tools, ehrlich getestet.",
  en: "AI tools, honestly tested.",
};

export const FollowCtaSlide: React.FC<EndSlideProps<{ type: "follow-cta"; config: FollowCtaConfig }>> = ({
  data,
  theme,
  locale,
  brandTokens,
}) => {
  const { config } = data;
  const headline = config.customMessage ?? HEADLINE[locale];

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="top-right" glowColor="brand">
      {(tokens) => (
        <>
          {/* Brand monogram circle */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${tokens.brand[500]}, ${tokens.brand[900]})`,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 0 80px color-mix(in oklch, ${tokens.brand[500]} 32%, transparent)`,
            }}
          >
            <svg
              width={56}
              height={56}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx={12} cy={7} r={4} />
              <path d="M19 8v6M22 11h-6" />
            </svg>
          </div>

          <div
            style={{
              fontSize: 72,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: tokens.ink.base,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              fontSize: 30,
              fontWeight: 500,
              color: tokens.ink.muted,
              lineHeight: 1.4,
              maxWidth: 720,
            }}
          >
            {SUBLINE[locale]}
          </div>

          <div
            style={{
              marginTop: 32,
              padding: "20px 36px",
              borderRadius: 999,
              border: `2px solid ${tokens.brand[500]}`,
              fontSize: 40,
              fontWeight: tokens.typography.headingWeight,
              color: tokens.brand[500],
              letterSpacing: "-0.01em",
            }}
          >
            {config.handle}
          </div>
        </>
      )}
    </EndSlideBase>
  );
};
