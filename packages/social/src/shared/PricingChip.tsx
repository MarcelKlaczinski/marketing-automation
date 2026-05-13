import React from "react";
import { pricingColor } from "../lib/theme.ts";

type Props = {
  tier: "free" | "freemium" | "paid";
  label: string;
  fontFamily: string;
  theme?: "dark" | "light";
};

function TierIcon({ tier, color }: { tier: Props["tier"]; color: string }) {
  const s = { width: 16, height: 16, display: "inline-block" as const, flexShrink: 0 };
  if (tier === "free") {
    // Checkmark circle
    return (
      <svg viewBox="0 0 16 16" style={s} fill="none">
        <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" />
        <path d="M4.5 8.5l2.5 2.5 4.5-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tier === "freemium") {
    // Half-filled circle
    return (
      <svg viewBox="0 0 16 16" style={s} fill="none">
        <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" />
        <path d="M8 1a7 7 0 0 1 0 14V1z" fill={color} />
      </svg>
    );
  }
  // paid: € symbol
  return (
    <svg viewBox="0 0 16 16" style={s} fill="none">
      <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" />
      <text x="8" y="12" textAnchor="middle" fill={color} fontSize="9" fontWeight="700">€</text>
    </svg>
  );
}

const TIER_LABEL: Record<Props["tier"], string> = {
  free: "Kostenlos",
  freemium: "Freemium",
  paid: "Kostenpflichtig",
};

export function PricingChip({ tier, label, fontFamily, theme = "dark" }: Props) {
  const color = pricingColor(tier);
  const rightAlpha = theme === "light" ? "33" : "18"; // stronger tint on white bg
  return (
    <div
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "stretch",
        borderRadius: 14,
        overflow: "hidden",
        border: `1.5px solid ${color}`,
      }}
    >
      {/* Left: tier badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 18px",
          background: color,
        }}
      >
        <TierIcon tier={tier} color="#fff" />
        <span style={{ fontFamily, fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>
          {TIER_LABEL[tier]}
        </span>
      </div>
      {/* Right: price label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 20px",
          background: `${color}${rightAlpha}`,
        }}
      >
        <span style={{ fontFamily, fontSize: 18, fontWeight: 600, color }}>
          {label}
        </span>
      </div>
    </div>
  );
}
