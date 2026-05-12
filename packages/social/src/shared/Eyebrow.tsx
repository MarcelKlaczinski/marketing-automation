import React from "react";
import type { ThemeTokens } from "../lib/theme.ts";

type Props = {
  text: string;
  theme: ThemeTokens;
  fontFamily: string;
  letterSpacing: string;
};

export function Eyebrow({ text, theme, fontFamily, letterSpacing }: Props) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing,
        textTransform: "uppercase",
        color: theme.eyebrowColor,
      }}
    >
      {text}
    </p>
  );
}
