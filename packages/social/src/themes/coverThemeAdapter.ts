import type { BrandTokens } from "../compositions/list-carousel/types.ts";

export interface CoverColors {
  background: string;
  eyebrow: string;
  hookText: string;
  hookHighlight: string;
  subline: string;
  promiseAccentBar: string;
  promiseLine1: string;
  promiseLine2: string;
  bigNumber: string;
  footerHandle: string;
  footerSub: string;
  footerDivider: string;
}

export function getCoverColors(
  theme: "dark" | "light",
  brand: BrandTokens,
): CoverColors {
  const primary = brand.colors.primary ?? "oklch(64% 0.16 248)";
  const accent = brand.colors.accent ?? "oklch(72% 0.15 168)";

  if (theme === "dark") {
    return {
      background: "#0A1428",
      eyebrow: accent,
      hookText: "#E5E7EB",
      hookHighlight: primary,
      subline: "#9CA3AF",
      promiseAccentBar: accent,
      promiseLine1: "#E5E7EB",
      promiseLine2: accent,
      bigNumber: `color-mix(in oklch, ${primary} 13%, transparent)`,
      footerHandle: "#E5E7EB",
      footerSub: "#888780",
      footerDivider: "rgba(255, 255, 255, 0.08)",
    };
  }

  // LIGHT = WHITE (not cream)
  return {
    background: "#FFFFFF",
    eyebrow: primary,
    hookText: "#0F1729",
    hookHighlight: primary,
    subline: "#5F5E5A",
    promiseAccentBar: accent,
    promiseLine1: "#0F1729",
    promiseLine2: accent,
    bigNumber: `color-mix(in oklch, ${primary} 8%, transparent)`,
    footerHandle: "#0F1729",
    footerSub: "#5F5E5A",
    footerDivider: "rgba(0, 0, 0, 0.08)",
  };
}
