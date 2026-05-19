import React from "react";

type Props = {
  prosColor: string;
  consColor: string;
  width: number;
  height: number;
  tintAlpha?: number; // percentage 0-100, default 12
};

export function DiagonalSplit({ prosColor, consColor, width, height, tintAlpha = 12 }: Props) {
  const splitTopX = width * 0.56;
  const splitBottomX = width * 0.44;

  return (
    <>
      {/* Left half (pros) - green tint */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${prosColor} ${tintAlpha}%, transparent)`,
          clipPath: `polygon(0 0, ${splitTopX}px 0, ${splitBottomX}px ${height}px, 0 ${height}px)`,
        }}
      />
      {/* Right half (cons) - red tint */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${consColor} ${tintAlpha}%, transparent)`,
          clipPath: `polygon(${splitTopX}px 0, ${width}px 0, ${width}px ${height}px, ${splitBottomX}px ${height}px)`,
        }}
      />
      {/* Diagonal divider line */}
      <svg
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
        width={width}
        height={height}
      >
        <line
          x1={splitTopX}
          y1={0}
          x2={splitBottomX}
          y2={height}
          stroke="oklch(80% 0.02 250)"
          strokeWidth={1.5}
          opacity={0.25}
        />
      </svg>
    </>
  );
}
