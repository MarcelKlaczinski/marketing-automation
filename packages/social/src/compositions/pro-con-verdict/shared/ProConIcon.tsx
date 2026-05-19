import React from "react";

type Props = {
  type: "pro" | "con";
  color: string;
  size?: number;
};

export function ProConIcon({ type, color, size = 36 }: Props) {
  const bgFill = `color-mix(in oklch, ${color} 18%, transparent)`;

  if (type === "pro") {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="17" style={{ fill: bgFill }} />
        <polyline
          points="9,18 15,24 27,12"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <circle cx="18" cy="18" r="17" style={{ fill: bgFill }} />
      <line x1="12" y1="12" x2="24" y2="24" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <line x1="24" y1="12" x2="12" y2="24" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}
