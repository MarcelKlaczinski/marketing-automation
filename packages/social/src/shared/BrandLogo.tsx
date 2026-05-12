import React from "react";
import type { ThemeTokens } from "../lib/theme.ts";

type Props = {
  websiteUrl: string;
  instagramHandle: string;
  theme: ThemeTokens;
  fontFamily: string;
  slideLabel: string; // e.g. "1/7"
};

export function BrandFooter({ websiteUrl, instagramHandle, theme, fontFamily, slideLabel }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily, fontSize: 20, fontWeight: 700, color: theme.ink }}>
          {websiteUrl}
        </span>
        <span style={{ fontFamily, fontSize: 16, color: theme.inkMuted }}>
          {instagramHandle}
        </span>
      </div>
      <span
        style={{
          fontFamily,
          fontSize: 18,
          fontWeight: 600,
          color: theme.inkMuted,
        }}
      >
        {slideLabel}
      </span>
    </div>
  );
}
