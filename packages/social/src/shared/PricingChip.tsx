import React from "react";
import { pricingColor } from "../lib/theme.ts";

type Props = {
  tier: "free" | "freemium" | "paid";
  label: string;
  fontFamily: string;
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

export function PricingChip({ tier, label, fontFamily }: Props) {
  const color = pricingColor(tier);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 16px",
        borderRadius: 999,
        border: `1.5px solid ${color}`,
        color,
        fontFamily,
        fontSize: 17,
        fontWeight: 600,
      }}
    >
      <TierIcon tier={tier} color={color} />
      {label}
    </span>
  );
}
