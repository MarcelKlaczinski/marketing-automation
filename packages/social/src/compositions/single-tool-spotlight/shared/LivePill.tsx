import React from "react";
import type { DsTokens } from "../../../brand-tokens/derive";

interface LivePillProps {
  tokens: DsTokens;
}

export const LivePill: React.FC<LivePillProps> = ({ tokens }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 12px",
      borderRadius: 999,
      fontSize: 12,
      fontFamily: tokens.typography.fontFamily,
      fontWeight: 700,
      letterSpacing: "0.12em",
      textTransform: "uppercase" as const,
      color: tokens.accent[500],
      background: `color-mix(in oklab, ${tokens.accent[500]} 12%, transparent)`,
    }}
  >
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: tokens.accent[500],
        flexShrink: 0,
      }}
    />
    LIVE
  </span>
);
