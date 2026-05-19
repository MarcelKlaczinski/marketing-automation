import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";

export const toolwikiBrandTokens: BrandTokens = {
  colors: {
    primary: "oklch(64% 0.16 248)",
    brandHue: 248,
    accent: "oklch(72% 0.15 168)",
    accentHue: 168,
    surface: "#ffffff",
    surfaceDark: "oklch(16% 0.02 250)",
    ink: "oklch(20% 0.025 250)",
    inkMuted: "oklch(45% 0.025 250)",
    pricingFree: "#22c55e",
    pricingFreemium: "#3b82f6",
    pricingPaid: "#f59e0b",
  },
  typography: {
    fontFamily: "Inter Variable, Inter, sans-serif",
    fontFamilyMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    headingWeight: 700,
    bodyWeight: 400,
    eyebrowLetterSpacing: "0.14em",
    rankBadgeSize: 72,
    rankBadgeWeight: 900,
    rankBadgeLetterSpacing: "-0.03em",
    footerWebsiteSize: 20,
    footerHandleSize: 16,
    footerLabelSize: 18,
    footerGap: 2,
  },
  voice: { locale: "de-DE", addressForm: "du", forbiddenWords: [], signaturePhrases: [] },
  social: { instagramHandle: "@toolwiki.ai", websiteUrl: "toolwiki.ai", logoAssetKey: "main" },
};

// Custom-hue project — orange brand, cyan accent
export const orangeBrandTokens: BrandTokens = {
  ...toolwikiBrandTokens,
  colors: {
    ...toolwikiBrandTokens.colors,
    brandHue: 30,
    accentHue: 200,
  },
};
