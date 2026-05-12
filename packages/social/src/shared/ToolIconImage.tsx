import React from "react";

type Props = {
  iconUrl?: string;       // file:// or https:// path to PNG
  initials?: string;      // fallback: 2 uppercase letters
  hue?: number;           // fallback: HSL hue for background
  size?: number;
};

export function ToolIconImage({ iconUrl, initials, hue = 200, size = 80 }: Props) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        width={size}
        height={size}
        style={{ objectFit: "contain", borderRadius: 16 }}
      />
    );
  }

  const bg = `hsl(${hue}, 65%, 55%)`;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 16,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 800,
        color: "#fff",
      }}
    >
      {initials ?? "??"}
    </div>
  );
}
