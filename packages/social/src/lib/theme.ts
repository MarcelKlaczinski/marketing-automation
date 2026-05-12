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

export function getThemeTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light"
): ThemeTokens {
  if (theme === "dark") {
    return {
      bg:           brandTokens.colors.surfaceDark,
      surface:      "oklch(22% 0.02 248)",
      ink:          "oklch(95% 0.01 250)",
      inkMuted:     "oklch(70% 0.025 250)",
      brand:        brandTokens.colors.primary,
      accent:       brandTokens.colors.accent,
      eyebrowColor: "oklch(85% 0.10 168)",
    };
  }
  return {
    bg:           brandTokens.colors.wikiCream,
    surface:      brandTokens.colors.surface,
    ink:          brandTokens.colors.ink,
    inkMuted:     brandTokens.colors.inkMuted,
    brand:        brandTokens.colors.primary,
    accent:       brandTokens.colors.accent,
    eyebrowColor: "oklch(48% 0.14 248)",
  };
}

export function pricingColor(tier: "free" | "freemium" | "paid"): string {
  switch (tier) {
    case "free":     return "#22c55e";  // green
    case "freemium": return "#3b82f6";  // blue
    case "paid":     return "#f59e0b";  // amber
  }
}
