import React from "react";

type Props = {
  iconSvg?: string;    // inline SVG string from resolution chain
  initials?: string;   // deterministic avatar fallback: 2 uppercase letters
  hue?: number;        // deterministic avatar fallback: hue for gradient
  size?: number;
  invertSvg?: boolean; // true (default): converts black SVG fills to white for dark card backgrounds
};

export function ToolIconImage({ iconSvg, initials, hue = 200, size = 80, invertSvg = true }: Props) {
  if (iconSvg) {
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
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: invertSvg ? "brightness(0) invert(1)" : undefined,
          }}
          // SVG content from simple-icons/iconify/lobe-icons — no user-supplied content
          // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled brand asset SVGs
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
      </div>
    );
  }

  // Deterministic HSL avatar — never emoji
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
