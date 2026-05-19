import React from "react";
import type { DsTokens } from "../../../brand-tokens/derive";
import { ToolIconImage } from "../../../shared/ToolIconImage";
import { LivePill } from "./LivePill";

interface HeroToolProps {
  tokens: DsTokens;
  /** Inline SVG string from resolution chain, or empty string to fall back to initials avatar. */
  logo: string;
  name: string;
  version: string;
  isLive?: boolean;
}

export const HeroTool: React.FC<HeroToolProps> = ({ tokens, logo, name, version, isLive }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
    <ToolIconImage
      {...(logo ? { iconSvg: logo } : {})}
      initials={name.slice(0, 2).toUpperCase()}
      hue={220}
      size={128}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontSize: 76,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: tokens.typography.headingWeight,
            lineHeight: 1,
            color: tokens.ink.base,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 18,
            color: tokens.ink.muted,
            whiteSpace: "nowrap",
          }}
        >
          {version}
        </span>
        {isLive && <LivePill tokens={tokens} />}
      </div>
    </div>
  </div>
);
