import React from "react";
import type { ThemeTokens } from "../lib/theme.ts";

type Props = {
  theme: ThemeTokens;
  aurora?: boolean; // subtle aurora gradient for EndSlide
};

export function BackgroundLayer({ theme, aurora = false }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: aurora
          ? `radial-gradient(ellipse 80% 60% at 50% 110%, ${theme.accent}33 0%, transparent 70%), ${theme.bg}`
          : theme.bg,
      }}
    />
  );
}
