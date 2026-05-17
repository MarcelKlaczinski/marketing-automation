import type { BrandTokens } from "../compositions/list-carousel/types.ts";

export type ThemeTokens = {
  bg: string;
  surface: string;
  ink: string;
  inkMuted: string;
  brand: string;
  accent: string;
  eyebrowColor: string;
};

const DARK_DEFAULTS = {
  surfaceDark: "oklch(16% 0.02 250)",
  primary:     "oklch(64% 0.16 248)",
  accent:      "oklch(72% 0.15 168)",
};

const LIGHT_DEFAULTS = {
  wikiCream: "#fef9ec",
  surface:   "#ffffff",
  ink:       "oklch(20% 0.025 250)",
  inkMuted:  "oklch(45% 0.025 250)",
  primary:   "oklch(64% 0.16 248)",
  accent:    "oklch(72% 0.15 168)",
};

export function getThemeTokens(
  brandTokens: BrandTokens | undefined,
  theme: "dark" | "light"
): ThemeTokens {
  const c = brandTokens?.colors;
  if (theme === "dark") {
    return {
      bg:           c?.surfaceDark       ?? DARK_DEFAULTS.surfaceDark,
      surface:      c?.surfaceSecondary  ?? "oklch(22% 0.02 248)",
      ink:          "oklch(95% 0.01 250)",
      inkMuted:     "oklch(70% 0.025 250)",
      brand:        c?.primary           ?? DARK_DEFAULTS.primary,
      accent:       c?.accent            ?? DARK_DEFAULTS.accent,
      eyebrowColor: c?.eyebrowColor      ?? "oklch(85% 0.10 168)",
    };
  }
  return {
    bg:           "#ffffff",
    surface:      c?.surface    ?? LIGHT_DEFAULTS.surface,
    ink:          c?.ink        ?? LIGHT_DEFAULTS.ink,
    inkMuted:     c?.inkMuted   ?? LIGHT_DEFAULTS.inkMuted,
    brand:        c?.primary    ?? LIGHT_DEFAULTS.primary,
    accent:       c?.accent     ?? LIGHT_DEFAULTS.accent,
    eyebrowColor: c?.primary    ?? LIGHT_DEFAULTS.primary,
  };
}

export function pricingColor(
  tier: "free" | "freemium" | "paid",
  brandTokens?: BrandTokens,
): string {
  const c = brandTokens?.colors;
  switch (tier) {
    case "free":     return c?.pricingFree     ?? "#22c55e";
    case "freemium": return c?.pricingFreemium ?? "#3b82f6";
    case "paid":     return c?.pricingPaid     ?? "#f59e0b";
  }
}
