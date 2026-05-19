import type { BrandTokens } from "../list-carousel/types.ts";

const DEFAULT_PROS_COLOR = "oklch(0.78 0.15 145)";
const DEFAULT_CONS_COLOR = "oklch(0.68 0.18 25)";

export function resolveProsColor(brandTokens?: BrandTokens): string {
  if (brandTokens?.colors?.prosColor) return brandTokens.colors.prosColor;
  return DEFAULT_PROS_COLOR;
}

export function resolveConsColor(brandTokens?: BrandTokens): string {
  if (brandTokens?.colors?.consColor) return brandTokens.colors.consColor;
  return DEFAULT_CONS_COLOR;
}
