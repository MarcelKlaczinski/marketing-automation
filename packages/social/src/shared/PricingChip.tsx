import React from "react";
import { pricingColor } from "../lib/theme.ts";

type Props = {
  tier: "free" | "freemium" | "paid";
  label: string;
  fontFamily: string;
};

export function PricingChip({ tier, label, fontFamily }: Props) {
  const color = pricingColor(tier);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 14px",
        borderRadius: 999,
        border: `1.5px solid ${color}`,
        color,
        fontFamily,
        fontSize: 18,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}
