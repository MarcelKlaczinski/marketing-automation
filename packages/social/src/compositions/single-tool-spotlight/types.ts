import { z } from "zod";
import { brandTokensSchema } from "../list-carousel/types.ts";
import { singleToolSpotlightOverridesSchema } from "../../templates/overrides/singleToolSpotlight.overrides.ts";

const proConItemSchema = z.object({
  text: z.string(),
  category: z.string().optional(),
});

export const singleToolSpotlightInputSchema = z.object({
  slideIndex: z.number().int().min(0).default(0),
  theme: z.enum(["dark", "light"]).default("dark"),
  locale: z.enum(["de", "en"]).default("de"),
  // Fix Y: replaced flat websiteUrl/instagramHandle with brandTokens (matches list-carousel pattern)
  brandTokens: brandTokensSchema.default({}),
  articleSlug: z.string().default(""),
  totalSlides: z.number().int().min(4).max(5).default(4),
  // Spec 57.3 — project-scoped overrides; defaults applied when absent
  overrides: singleToolSpotlightOverridesSchema.optional(),
  tool: z.object({
    slug: z.string(),
    name: z.string(),
    tagline: z.string().optional(),
    website: z.string().optional(),
    primaryCategory: z.string().optional(),
    pricingTier: z.enum(["free", "freemium", "paid", "enterprise"]).optional(),
    priceFrom: z.number().optional(),
    rating: z.number().min(0).max(5).optional(),
    pros: z.array(proConItemSchema).min(2).max(5),
    cons: z.array(proConItemSchema).max(4).default([]),
    features: z.array(z.string()).max(6).default([]),
    useCases: z.array(z.string()).max(4).default([]),
    affiliateSlug: z.string().optional(),
    iconSvg: z.string().optional(),
    iconInitials: z.string().optional(),
    iconHue: z.number().optional(),
  }),
});

export type SingleToolSpotlightInput = z.infer<typeof singleToolSpotlightInputSchema>;
