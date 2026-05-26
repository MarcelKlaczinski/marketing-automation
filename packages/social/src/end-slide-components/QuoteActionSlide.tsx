import React from "react";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideProps, QuoteActionConfig } from "./types";

export const QuoteActionSlide: React.FC<
  EndSlideProps<{ type: "quote-action"; config: QuoteActionConfig }>
> = ({ data, theme, brandTokens }) => {
  const { config } = data;

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="bottom-right" glowColor="accent">
      {(tokens) => (
        <>
          {/* Decorative oversized quote mark */}
          <div
            style={{
              fontSize: 220,
              fontWeight: 900,
              fontFamily: tokens.typography.fontFamily,
              color: tokens.accent[500],
              lineHeight: 0.6,
              letterSpacing: "-0.06em",
              marginBottom: -32,
              opacity: 0.85,
            }}
            aria-hidden
          >
            “
          </div>

          <div
            style={{
              fontSize: 64,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.028em",
              lineHeight: 1.15,
              color: tokens.ink.base,
              maxWidth: 920,
            }}
          >
            {config.quote}
          </div>

          {/* Accent underline */}
          <div
            style={{
              width: 96,
              height: 4,
              borderRadius: 2,
              background: tokens.accent[500],
              marginTop: 16,
            }}
          />

          {config.attribution ? (
            <div
              style={{
                fontSize: 26,
                fontWeight: 500,
                color: tokens.ink.muted,
                letterSpacing: tokens.typography.eyebrowLetterSpacing,
                textTransform: "uppercase",
                marginTop: 8,
              }}
            >
              {config.attribution}
            </div>
          ) : null}
        </>
      )}
    </EndSlideBase>
  );
};
