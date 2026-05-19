import React from "react";
import type { DsTokens } from "../../../brand-tokens/derive";

interface Fact {
  key: string;
  value: string;
}

interface StatsRowProps {
  tokens: DsTokens;
  score: number;
  scoreLabel: string;
  facts: Fact[];
}

export const StatsRow: React.FC<StatsRowProps> = ({ tokens, score, scoreLabel, facts }) => (
  <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
    {/* Score block */}
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 32px",
        background: tokens.surface.raised,
        border: `1px solid ${tokens.border}`,
        borderRadius: 18,
        minWidth: 160,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontFamily: tokens.typography.fontFamilyMono,
          fontSize: 88,
          fontWeight: 700,
          lineHeight: 1,
          color: tokens.accent[500],
          fontFeatureSettings: '"tnum"',
          letterSpacing: "-0.02em",
        }}
      >
        {score}
      </div>
      <div
        style={{
          fontSize: 15,
          fontFamily: tokens.typography.fontFamily,
          fontWeight: 600,
          color: tokens.ink.muted,
          marginTop: 8,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {scoreLabel}
      </div>
    </div>

    {/* Facts grid 2×2 */}
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 12,
      }}
    >
      {facts.slice(0, 4).map((fact) => (
        <div
          key={fact.key}
          style={{
            background: tokens.surface.raised,
            border: `1px solid ${tokens.border}`,
            borderRadius: 14,
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 600,
              color: tokens.ink.muted,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fact.key}
          </div>
          <div
            style={{
              fontSize: 17,
              fontFamily: tokens.typography.fontFamily,
              fontWeight: 700,
              color: tokens.ink.base,
              marginTop: 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fact.value}
          </div>
        </div>
      ))}
    </div>
  </div>
);
