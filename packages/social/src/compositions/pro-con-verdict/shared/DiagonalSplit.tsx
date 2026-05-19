import React from "react";

type Props = {
  prosColor: string;
  consColor: string;
  width: number;
  height: number;
  tintAlpha?: number;
  strokeColor?: string;
};

// 58% at top → 42% at bottom gives a clean lean with enough safe zone in each half.
const SPLIT_RATIO_TOP = 0.58;
const SPLIT_RATIO_BOTTOM = 0.42;

export function DiagonalSplit({ prosColor, consColor, width, height, tintAlpha = 12, strokeColor = "oklch(60% 0.02 250)" }: Props) {
  const splitTopX = width * SPLIT_RATIO_TOP;
  const splitBottomX = width * SPLIT_RATIO_BOTTOM;

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${prosColor} ${tintAlpha}%, transparent)`,
          clipPath: `polygon(0 0, ${splitTopX}px 0, ${splitBottomX}px ${height}px, 0 ${height}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `color-mix(in oklch, ${consColor} ${tintAlpha}%, transparent)`,
          clipPath: `polygon(${splitTopX}px 0, ${width}px 0, ${width}px ${height}px, ${splitBottomX}px ${height}px)`,
        }}
      />
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
          stroke={strokeColor}
          strokeWidth={1.5}
          opacity={0.2}
        />
      </svg>
    </>
  );
}
