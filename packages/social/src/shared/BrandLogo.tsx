import React from "react";
import type { BrandTokens } from "../compositions/list-carousel/types.ts";
import type { ThemeTokens } from "../lib/theme.ts";

type Props = {
  websiteUrl: string;
  instagramHandle: string;
  theme: ThemeTokens;
  fontFamily: string;
  slideLabel: string; // e.g. "1/7"
  brandTokens?: BrandTokens;
};

export function BrandFooter({ websiteUrl, instagramHandle, theme, fontFamily, slideLabel, brandTokens }: Props) {
  const t = brandTokens?.typography;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: t?.footerGap ?? 2 }}>
        <span style={{ fontFamily, fontSize: t?.footerWebsiteSize ?? 20, fontWeight: 700, color: theme.ink }}>
          {websiteUrl}
        </span>
        <span style={{ fontFamily, fontSize: t?.footerHandleSize ?? 16, color: theme.inkMuted }}>
          {instagramHandle}
        </span>
      </div>
      <span
        style={{
          fontFamily,
          fontSize: t?.footerLabelSize ?? 18,
          fontWeight: 600,
          color: theme.inkMuted,
        }}
      >
        {slideLabel}
      </span>
    </div>
  );
}
