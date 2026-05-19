import React from "react";
import { Img } from "remotion";
import type { DsTokens } from "../brand-tokens/derive";

export interface DsFootProps {
  tokens: DsTokens;
  /** Logo image URL (typically wordmark from brandTokens.social.logoAssetKey resolution). */
  logoUrl?: string;
  /** Fallback text logo if logoUrl is absent. */
  logoText?: string;
  /** Optional lead line above the bold CTA. Example: "Sophie Renner ·" */
  ctaLead?: string;
  /** Bold CTA line. Example: "Vollständiger Test →" */
  ctaBold: string;
  /** Logo height in px. Default 44; cover passes 48. */
  logoHeight?: number;
}

export const DsFoot: React.FC<DsFootProps> = ({
  tokens,
  logoUrl,
  logoText,
  ctaLead,
  ctaBold,
  logoHeight = 44,
}) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}
    >
      <div>
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: logoHeight, display: "block" }} />
        ) : logoText ? (
          <span
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: tokens.typography.headingWeight,
              fontSize: Math.round(logoHeight * 0.6),
              color: tokens.ink.base,
            }}
          >
            {logoText}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 18,
          color: tokens.ink.muted,
          textAlign: "right",
          lineHeight: 1.4,
        }}
      >
        {ctaLead && <>{ctaLead}<br /></>}
        <strong style={{ color: tokens.ink.base, fontWeight: 600 }}>{ctaBold}</strong>
      </div>
    </div>
  );
};
