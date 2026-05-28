/**
 * Spec 65.17 B3 — Tier-color tokens (semantic gold / silver / bronze).
 *
 * Colocated with the `tool-tier-ranking` composition because tier-colors are
 * template-private semantic overlays (Discovery §3.4). They are NOT promoted
 * to `DsTokens` to keep the global token surface small and to preserve a
 * clear distinction between brand tokens (project-tunable) and tier semantics
 * (universal: gold = top, silver = middle, bronze = bottom).
 *
 * Each tier returns three derived colors:
 *  - `surface`    — subtle wash for the lane background (~12% alpha on theme)
 *  - `border`     — stronger accent for left-edge / badge border
 *  - `text`       — high-contrast color for tier label text
 *
 * Light + dark theme variants. oklch alpha-mix is used per
 * `packages/social/CLAUDE.md` "Gotchas — oklch transparency".
 */

import type { Tier } from "./types";

export interface TierColorTokens {
  surface: string;
  border: string;
  text: string;
}

const DARK_THEME: Record<Tier, TierColorTokens> = {
  spitze: {
    // Gold — top tier
    surface: "color-mix(in oklch, oklch(0.82 0.13 85) 14%, transparent)",
    border:  "oklch(0.82 0.13 85)",
    text:    "oklch(0.92 0.11 85)",
  },
  stark: {
    // Silver — middle tier
    surface: "color-mix(in oklch, oklch(0.85 0.02 250) 12%, transparent)",
    border:  "oklch(0.82 0.02 250)",
    text:    "oklch(0.92 0.02 250)",
  },
  solide: {
    // Bronze — base tier
    surface: "color-mix(in oklch, oklch(0.68 0.09 45) 12%, transparent)",
    border:  "oklch(0.68 0.09 45)",
    text:    "oklch(0.86 0.07 45)",
  },
};

const LIGHT_THEME: Record<Tier, TierColorTokens> = {
  spitze: {
    surface: "color-mix(in oklch, oklch(0.78 0.14 85) 18%, transparent)",
    border:  "oklch(0.65 0.15 85)",
    text:    "oklch(0.38 0.12 85)",
  },
  stark: {
    surface: "color-mix(in oklch, oklch(0.78 0.02 250) 18%, transparent)",
    border:  "oklch(0.62 0.02 250)",
    text:    "oklch(0.32 0.02 250)",
  },
  solide: {
    surface: "color-mix(in oklch, oklch(0.62 0.10 45) 16%, transparent)",
    border:  "oklch(0.55 0.11 45)",
    text:    "oklch(0.32 0.10 45)",
  },
};

export function getTierColors(theme: "dark" | "light", tier: Tier): TierColorTokens {
  return (theme === "dark" ? DARK_THEME : LIGHT_THEME)[tier];
}

/**
 * Locale-resolved tier labels. Marcel-decision Q2 — positive framing for
 * affiliate-safety. Never "Bad" / "Schlecht" / "Mid" — only the three
 * approved positives.
 */
export function tierLabel(tier: Tier, locale: "de" | "en"): string {
  if (locale === "de") {
    return tier === "spitze" ? "Spitze" : tier === "stark" ? "Stark" : "Solide";
  }
  return tier === "spitze" ? "Top" : tier === "stark" ? "Solid" : "Decent";
}
