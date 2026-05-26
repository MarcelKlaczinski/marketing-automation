import React from "react";
import { EndSlideBase } from "./shared/EndSlideBase";
import type { EndSlideProps, TagFriendConfig } from "./types";

export const TagFriendSlide: React.FC<
  EndSlideProps<{ type: "tag-friend"; config: TagFriendConfig }>
> = ({ data, theme, brandTokens }) => {
  const { config } = data;

  return (
    <EndSlideBase theme={theme} brandTokens={brandTokens} glowCorner="top-right" glowColor="accent">
      {(tokens) => (
        <>
          {/* Tag/at icon */}
          <div
            style={{
              width: 116,
              height: 116,
              borderRadius: 28,
              background: `linear-gradient(135deg, ${tokens.accent[500]}, ${tokens.accent[600]})`,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 0 70px color-mix(in oklch, ${tokens.accent[500]} 28%, transparent)`,
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
              <circle cx={12} cy={12} r={4} />
              <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-9 9" />
            </svg>
          </div>

          <div
            style={{
              fontSize: 68,
              fontWeight: tokens.typography.headingWeight,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              color: tokens.ink.base,
              maxWidth: 880,
            }}
          >
            {config.prompt}
          </div>

          {config.context ? (
            <div
              style={{
                fontSize: 32,
                fontWeight: 500,
                color: tokens.ink.muted,
                lineHeight: 1.4,
                maxWidth: 800,
              }}
            >
              {config.context}
            </div>
          ) : null}

          {/* Decorative @ chips suggesting tagged usernames */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {["@friend", "@team", "@?"].map((label, idx) => (
              <div
                key={label}
                style={{
                  padding: "12px 24px",
                  borderRadius: 999,
                  border: `1.5px solid ${tokens.border}`,
                  background: tokens.surface.raised,
                  color: tokens.ink.muted,
                  fontSize: 24,
                  fontWeight: 500,
                  opacity: Math.max(0.5, 1 - idx * 0.22),
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </EndSlideBase>
  );
};
