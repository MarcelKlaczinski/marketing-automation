import { z } from "zod";

export const brandTokensSchema = z.object({
  colors: z
    .object({
      primary: z.string().default("oklch(64% 0.16 248)"),
      primaryHue: z.number().default(248),
      accent: z.string().default("oklch(72% 0.15 168)"),
      surface: z.string().default("#ffffff"),
      surfaceDark: z.string().default("oklch(16% 0.02 250)"),
      ink: z.string().default("oklch(20% 0.025 250)"),
      inkMuted: z.string().default("oklch(45% 0.025 250)"),
      wikiCream: z.string().default("#fef9ec"),
    })
    .default({}),
  typography: z
    .object({
      fontFamily: z.string().default("Inter Variable, Inter, sans-serif"),
      headingWeight: z.number().default(800),
      bodyWeight: z.number().default(400),
      eyebrowLetterSpacing: z.string().default("0.08em"),
    })
    .default({}),
  voice: z
    .object({
      locale: z.string().default("de-DE"),
      addressForm: z.string().default("du"),
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
});

export type BrandTokens = z.infer<typeof brandTokensSchema>;

const toolSchema = z.object({
  slug: z.string(),
  rank: z.number().int(),
  name: z.string(),
  domain: z.string(),
  eyebrow: z.string().max(40),
  tagline: z.string().max(120),
  bestFor: z.string().max(40).optional(),
  strengths: z.array(z.string()).min(2).max(4),
  pricing: z.object({
    tier: z.enum(["free", "freemium", "paid"]),
    label: z.string(),
  }),
  // Resolved icon — passed in by pipeline after icon-resolver lookup
  iconSvg: z.string().optional(),      // inline SVG from resolution chain (simple-icons/iconify/lobe-icons)
  iconInitials: z.string().optional(), // deterministic avatar fallback
  iconHue: z.number().optional(),
});

export type Tool = z.infer<typeof toolSchema>;

export const listCarouselInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  brandTokens: brandTokensSchema.default({}),
  slideIndex: z.number().int().default(0),

  cover: z.object({
    eyebrow: z.string().max(40),
    headlineLead: z.string().max(30),
    headlineHighlight: z.string().max(40),
    headlineTrail: z.string().max(20).optional(),
    subhead: z.string().max(80).optional(),
  }),

  tools: z.array(toolSchema).min(3).max(10),

  end: z.object({
    headline: z.string().max(40),
    headlineHighlight: z.string().max(40),
    articleUrl: z.string(),
    qrCodeUrl: z.string().optional(),
  }),
});

export type ListCarouselInput = z.infer<typeof listCarouselInputSchema>;
