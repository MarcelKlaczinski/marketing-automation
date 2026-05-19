import { z } from "zod";

export const brandTokensSchema = z
  .object({
    colors: z
      .object({
        // Brand scale — primary string kept for back-compat; derive from brandHue in 60.0b
        primary: z.string().default("oklch(64% 0.16 248)"),
        /** Hue for the brand color scale (0-360). Replaces primaryHue. */
        brandHue: z.number().min(0).max(360).default(248),

        // Accent scale — accent string kept for back-compat; derive from accentHue in 60.0b
        accent: z.string().default("oklch(72% 0.15 168)"),
        /** Hue for the accent color scale (0-360). */
        accentHue: z.number().min(0).max(360).default(168),

        // Surface — light + dark base values
        surface: z.string().default("#ffffff"),
        surfaceDark: z.string().default("oklch(16% 0.02 250)"),

        // Optional surface stops — if absent, derived from surface/surfaceDark at render time
        surfaceRaised: z.string().optional(),
        surfaceRaisedDark: z.string().optional(),
        surfaceSunken: z.string().optional(),
        surfaceSunkenDark: z.string().optional(),

        // Border — optional override; derived from surface if absent
        border: z.string().optional(),
        borderDark: z.string().optional(),

        // Ink (text foreground)
        ink: z.string().default("oklch(20% 0.025 250)"),
        inkMuted: z.string().default("oklch(45% 0.025 250)"),

        // Semantic pricing colors
        pricingFree: z.string().default("#22c55e"),
        pricingFreemium: z.string().default("#3b82f6"),
        pricingPaid: z.string().default("#f59e0b"),

        // pro-con-verdict specific — optional; composition applies oklch defaults when absent
        prosColor: z.string().optional(),
        consColor: z.string().optional(),

        // DEPRECATED — kept for back-compat, will be removed in Spec 61+
        /** @deprecated Use surface + theme=dark via getThemeTokens instead */
        surfaceSecondary: z.string().optional(),
        /** @deprecated Use accent + theme handling instead */
        eyebrowColor: z.string().optional(),
        /** @deprecated Renamed to brandHue */
        primaryHue: z.number().optional(),
        /** @deprecated toolwiki-specific legacy color, not in DS reference */
        wikiCream: z.string().optional(),
      })
      .default({}),

    typography: z
      .object({
        fontFamily: z.string().default("Inter Variable, Inter, sans-serif"),
        fontFamilyMono: z
          .string()
          .default("ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"),

        headingWeight: z.number().int().min(100).max(900).default(800),
        bodyWeight: z.number().int().min(100).max(900).default(400),
        eyebrowLetterSpacing: z.string().default("0.08em"),

        // Rank badge — list-carousel specific
        rankBadgeSize: z.number().default(72),
        rankBadgeWeight: z.number().int().min(100).max(900).default(900),
        rankBadgeLetterSpacing: z.string().default("-0.03em"),

        // Footer — used across templates
        footerWebsiteSize: z.number().default(20),
        footerHandleSize: z.number().default(16),
        footerLabelSize: z.number().default(18),
        footerGap: z.number().default(2),
      })
      .default({}),

    voice: z
      .object({
        locale: z.string().default("de-DE"),
        addressForm: z.enum(["du", "Sie"]).default("du"),
        forbiddenWords: z.array(z.string()).default([]),
        signaturePhrases: z.array(z.string()).default([]),
      })
      .default({}),

    social: z
      .object({
        instagramHandle: z.string().default("@toolwiki.ai"),
        websiteUrl: z.string().default("toolwiki.ai"),
        logoAssetKey: z.string().default("main"),
      })
      .default({}),
  })
  .strip();
