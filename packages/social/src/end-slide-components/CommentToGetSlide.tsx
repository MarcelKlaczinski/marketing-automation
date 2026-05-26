import React from "react";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { CommentToGetConfig, EndSlideLocale, EndSlideProps } from "./types";

const PROMPT_LINE: Record<EndSlideLocale, string> = {
  de: "Kommentiere",
  en: "Comment",
};

const PAYOFF_LINE: Record<EndSlideLocale, (title: string) => React.ReactNode> = {
  de: (title) => (
    <>
      und wir senden dir
      <br />
      <strong>{title}</strong>
    </>
  ),
  en: (title) => (
    <>
      and we'll send you
      <br />
      <strong>{title}</strong>
    </>
  ),
};

export const CommentToGetSlide: React.FC<
  EndSlideProps<{ type: "comment-to-get"; config: CommentToGetConfig }>
> = ({ data, theme, locale, brandTokens }) => {
  const { config } = data;
  const prompt = config.promptText ?? PROMPT_LINE[locale];

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="top-left" glowColor="accent">
      {(tokens) => (
        <>
          <div
            style={{
              fontSize: 36,
              fontWeight: 500,
              color: tokens.ink.muted,
              letterSpacing: tokens.typography.eyebrowLetterSpacing,
              textTransform: "uppercase",
            }}
          >
            {prompt}
          </div>

          <div
            style={{
              fontSize: 132,
              fontWeight: tokens.typography.headingWeight,
              color: tokens.accent[500],
              lineHeight: 1,
              letterSpacing: "-0.04em",
              padding: "8px 0",
            }}
          >
            {`"${config.keyword}"`}
          </div>

          <div
            style={{
              fontSize: 38,
              fontWeight: tokens.typography.bodyWeight,
              color: tokens.ink.base,
              lineHeight: 1.35,
              maxWidth: 800,
            }}
          >
            {PAYOFF_LINE[locale](config.resourceTitle)}
          </div>

          {/* Hint arrow */}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: tokens.ink.muted,
              fontSize: 24,
              fontWeight: 500,
            }}
          >
            <svg
              width={28}
              height={28}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>{locale === "de" ? "in die Kommentare" : "in the comments"}</span>
          </div>
        </>
      )}
    </EndSlideBase>
  );
};
