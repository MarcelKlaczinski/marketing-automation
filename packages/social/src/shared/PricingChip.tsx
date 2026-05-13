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

/**
 * Spec 51a-stunning-v2.1 §4 — disambiguate the chip's secondary segment.
 * For freemium tools the LLM emits "ab 12 €/Monat" which contradicts the
 * "Freemium" badge (free implies no payment, "ab" implies paid-only). Prefix
 * a paid-plan price with "Pro" so the chip reads "Freemium [Pro ab 12 €/Mo]".
 * Free-only tools collapse to a single badge.
 */
export function deriveSecondaryLabel(tier: Props["tier"], label: string): string | null {
  const trimmed = label.trim();
  if (tier === "free") {
    // Either empty, "Kostenlos", or anything else — fall back to badge-only.
    return trimmed && !/^kostenlos$/i.test(trimmed) ? trimmed : null;
  }
  if (tier === "freemium") {
    if (!trimmed) return null;
    if (/^pro\b/i.test(trimmed)) return trimmed;          // already disambiguated
    if (/^ab\b/i.test(trimmed)) return `Pro ${trimmed}`;  // "ab 12 €/Mo" → "Pro ab 12 €/Mo"
    return trimmed;
  }
  return trimmed || null;
}

export function PricingChip({ tier, label, fontFamily, theme = "dark" }: Props) {
  const color = pricingColor(tier);
  const rightAlpha = theme === "light" ? "33" : "18"; // stronger tint on white bg
  const secondary = deriveSecondaryLabel(tier, label);
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
      {/* Right: secondary segment — omitted for free-only or redundant labels */}
      {secondary && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 20px",
            background: `${color}${rightAlpha}`,
          }}
        >
          <span style={{ fontFamily, fontSize: 18, fontWeight: 600, color }}>
            {secondary}
          </span>
        </div>
      )}
    </div>
  );
}
