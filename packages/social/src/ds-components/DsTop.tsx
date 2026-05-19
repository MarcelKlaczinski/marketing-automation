import React from "react";
import type { DsTokens } from "../brand-tokens/derive";

export interface DsTopProps {
  tokens: DsTokens;
  /** Eyebrow text (left side). Example: "Vergleich · 4 Bildgeneratoren" */
  eyebrow: string;
  /** Slide counter or date/URL (right side). Example: "01 / 06" or "As of 05/2026 · toolwiki.ai/images" */
  rightText: string;
  /** Optional secondary line under eyebrow (used by some templates for date/URL). */
  num?: string;
  /** Optional update-badge variant for cover slide (renders a pill on the right). */
  updateBadge?: string;
}

const DsUpdateBadge: React.FC<{ tokens: DsTokens; text: string }> = ({ tokens, text }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 14px",
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.04em",
      color: tokens.brand[300],
      background: `color-mix(in oklab, ${tokens.brand[500]} 10%, transparent)`,
    }}
  >
    {text}
  </span>
);

export const DsTop: React.FC<DsTopProps> = ({ tokens, eyebrow, rightText, num, updateBadge }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 17,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 700,
            letterSpacing: tokens.typography.eyebrowLetterSpacing,
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            color: tokens.ink.base,
          }}
        >
          {eyebrow}
        </div>
        {num && (
          <div
            style={{
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 17,
              color: tokens.ink.muted,
              marginTop: 8,
            }}
          >
            {num}
          </div>
        )}
      </div>
      {updateBadge ? (
        <DsUpdateBadge tokens={tokens} text={updateBadge} />
      ) : (
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 17,
            color: tokens.ink.muted,
            textAlign: "right",
            lineHeight: 1.5,
          }}
        >
          {rightText}
        </div>
      )}
    </div>
  );
};
