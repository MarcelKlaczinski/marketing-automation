import React from "react";

type Props = {
  iconUrl?: string;       // file:// or https:// path to PNG
  initials?: string;      // fallback: 2 uppercase letters
  hue?: number;           // fallback: hue for gradient background
  emoji?: string;         // preferred fallback over initials
  size?: number;
};

export function ToolIconImage({ iconUrl, initials, hue = 200, emoji, size = 80 }: Props) {
  if (iconUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.22,
          background: `linear-gradient(135deg, oklch(30% 0.04 250), oklch(20% 0.03 250))`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: size * 0.12,
          boxSizing: "border-box" as const,
        }}
      >
        <img src={iconUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    );
  }

  if (emoji) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `radial-gradient(135deg at 30% 30%, oklch(65% 0.18 ${hue}), oklch(40% 0.15 ${hue + 40}))`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.5,
          boxShadow: `0 4px 24px oklch(50% 0.15 ${hue} / 0.4)`,
        }}
      >
        {emoji}
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(135deg at 30% 30%, oklch(65% 0.18 ${hue}), oklch(40% 0.15 ${hue + 40}))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 800,
        color: "#fff",
        boxShadow: `0 4px 24px oklch(50% 0.15 ${hue} / 0.4)`,
      }}
    >
      {initials ?? "??"}
    </div>
  );
}
