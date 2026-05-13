import React from "react";
import type { ThemeTokens } from "../lib/theme.ts";

type Props = {
  theme: ThemeTokens;
  aurora?: boolean; // subtle aurora gradient for EndSlide
  cover?: boolean;  // richer mesh gradient for CoverSlide
};

export function BackgroundLayer({ theme, aurora = false, cover = false }: Props) {
  let background: string;
  if (cover) {
    background = `
      radial-gradient(ellipse 120% 80% at -10% 110%, color-mix(in oklch, ${theme.brand} 35%, transparent), transparent 60%),
      radial-gradient(ellipse 80% 60% at 110% -10%, color-mix(in oklch, ${theme.accent} 25%, transparent), transparent 55%),
      ${theme.bg}
    `;
  } else if (aurora) {
    background = `radial-gradient(ellipse 80% 60% at 50% 110%, color-mix(in oklch, ${theme.accent} 20%, transparent) 0%, transparent 70%), ${theme.bg}`;
  } else {
    background = theme.bg;
  }
  return (
    <div style={{ position: "absolute", inset: 0, background }} />
  );
}
