import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";

export interface DsTokens {
  brand: { 50: string; 100: string; 300: string; 500: string; 700: string; 900: string; 950: string };
  accent: { 500: string; 600: string };
  surface: { base: string; raised: string; sunken: string };
  border: string;
  ink: { base: string; muted: string };
  semantic: { success: string; warn: string; danger: string; info: string };
  shadows: { sm: string; md: string };
  pricing: { free: string; freemium: string; paid: string };
  typography: {
    fontFamily: string;
    fontFamilyMono: string;
    headingWeight: number;
    bodyWeight: number;
    eyebrowLetterSpacing: string;
  };
}

export function deriveDsTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
): DsTokens {
  const brandHue = brandTokens.colors.brandHue ?? 248;
  const accentHue = brandTokens.colors.accentHue ?? 168;

  const brand = {
    50:  `oklch(97% 0.018 ${brandHue})`,
    100: `oklch(94% 0.040 ${brandHue})`,
    300: `oklch(80% 0.100 ${brandHue})`,
    500: `oklch(64% 0.160 ${brandHue})`,
    700: `oklch(48% 0.140 ${brandHue})`,
    900: `oklch(32% 0.080 ${brandHue})`,
    950: `oklch(22% 0.060 ${brandHue})`,
  };

  const accent = {
    500: `oklch(72% 0.150 ${accentHue})`,
    600: `oklch(64% 0.160 ${accentHue})`,
  };

  const isDark = theme === "dark";

  return {
    brand,
    accent,
    surface: {
      base: isDark ? brandTokens.colors.surfaceDark : brandTokens.colors.surface,
      raised: isDark
        ? (brandTokens.colors.surfaceRaisedDark ?? "oklch(20% 0.025 250)")
        : (brandTokens.colors.surfaceRaised ?? "oklch(99% 0.005 250)"),
      sunken: isDark
        ? (brandTokens.colors.surfaceSunkenDark ?? "oklch(13% 0.020 250)")
        : (brandTokens.colors.surfaceSunken ?? "oklch(97% 0.010 250)"),
    },
    border: isDark
      ? (brandTokens.colors.borderDark ?? "oklch(28% 0.020 250)")
      : (brandTokens.colors.border ?? "oklch(92% 0.010 250)"),
    ink: {
      base: isDark ? "oklch(95% 0.010 250)" : "oklch(20% 0.025 250)",
      muted: isDark ? "oklch(95% 0.010 250 / 0.65)" : "oklch(20% 0.025 250 / 0.70)",
    },
    semantic: {
      success: "oklch(70% 0.160 145)",
      warn: "oklch(78% 0.160 75)",
      danger: "oklch(62% 0.200 28)",
      info: brand[500],
    },
    shadows: isDark
      ? { sm: "none", md: "none" }
      : {
          sm: "0 1px 2px oklch(0% 0 0 / 0.06), 0 4px 12px oklch(0% 0 0 / 0.05)",
          md: "0 1px 0 oklch(0% 0 0 / 0.04), 0 16px 32px -12px oklch(0% 0 0 / 0.18)",
        },
    pricing: {
      free: brandTokens.colors.pricingFree,
      freemium: brandTokens.colors.pricingFreemium,
      paid: brandTokens.colors.pricingPaid,
    },
    typography: {
      fontFamily: brandTokens.typography.fontFamily,
      fontFamilyMono: brandTokens.typography.fontFamilyMono,
      headingWeight: brandTokens.typography.headingWeight,
      bodyWeight: brandTokens.typography.bodyWeight,
      eyebrowLetterSpacing: brandTokens.typography.eyebrowLetterSpacing,
    },
  };
}
