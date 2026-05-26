import React from "react";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideLocale, EndSlideProps, LinkInBioConfig } from "./types";

const HEADLINE: Record<EndSlideLocale, string> = {
  de: "Link in Bio",
  en: "Link in bio",
};

export const LinkInBioSlide: React.FC<
  EndSlideProps<{ type: "link-in-bio"; config: LinkInBioConfig }>
> = ({ data, theme, locale, brandTokens }) => {
  const { config } = data;

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="bottom-right" glowColor="brand">
      {(tokens) => (
        <>
          {/* Link icon in circle */}
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: "50%",
              background: tokens.surface.raised,
              border: `2px solid ${tokens.brand[500]}`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg
              width={52}
              height={52}
              viewBox="0 0 24 24"
              fill="none"
              stroke={tokens.brand[500]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>

          <div
            style={{
              fontSize: 60,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: tokens.ink.base,
            }}
          >
            {HEADLINE[locale]}
          </div>

          <div
            style={{
              fontSize: 34,
              fontWeight: 500,
              color: tokens.ink.muted,
              lineHeight: 1.4,
              maxWidth: 800,
            }}
          >
            {config.description}
          </div>

          {config.url ? (
            <div
              style={{
                marginTop: 16,
                fontSize: 28,
                fontWeight: tokens.typography.headingWeight,
                color: tokens.brand[500],
                fontFamily: tokens.typography.fontFamilyMono,
                letterSpacing: "-0.01em",
              }}
            >
              {config.url}
            </div>
          ) : null}
        </>
      )}
    </EndSlideBase>
  );
};
