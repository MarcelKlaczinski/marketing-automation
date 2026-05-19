import { z } from "zod";

/** Per REMOTION.md CoverProps section */
export const coverPropsSchema = z.object({
  eyebrow:      z.string().min(8).max(28),
  headerNum:    z.string().min(12).max(56),
  updateBadge:  z.string().min(8).max(28).optional(),
  heroTitle:    z.string().min(6).max(22),
  kicker:       z.string().min(40).max(130),
  toolLogos: z.array(z.object({
    src: z.string(),
    alt: z.string(),
  })).min(1).max(6),
  toolsMoreText: z.string().min(4).max(14),
  stats: z.array(z.object({
    value: z.string().min(1).max(4),
    label: z.string().min(8).max(24),
  })).length(3),
  byline: z.object({
    initials: z.string().length(2),
    name:     z.string().min(4).max(22),
    role:     z.string().min(10).max(32),
    readTime: z.string().min(5).max(14),
  }),
  swipeText: z.string().min(12).max(28),
  footer: z.object({
    ctaLine: z.string().min(6).max(22),
    url:     z.string().min(12).max(32),
  }),
});

/** Per REMOTION.md SpotlightProps section */
export const spotlightBodyPropsSchema = z.object({
  eyebrow:    z.string().min(12).max(28),
  headerNum:  z.string().min(16).max(44),
  slideIndex: z.number().int().min(0),
  slideTotal: z.number().int().min(1),
  tool: z.object({
    logo:    z.string(),
    name:    z.string().min(4).max(14),
    version: z.string().min(6).max(34),
    isLive:  z.boolean().optional(),
  }),
  verdictQuote: z.string().min(40).max(120),
  score:        z.number().int().min(0).max(99),
  scoreLabel:   z.string().min(6).max(18),
  facts: z.array(z.object({
    key:   z.string().min(4).max(14),
    value: z.string().min(4).max(20),
  })).length(4),
  strengths:  z.array(z.string().min(30).max(70)).min(3).max(4),
  weaknesses: z.array(z.string().min(30).max(70)).min(3).max(4),
  footer: z.object({
    ctaLine: z.string().min(8).max(24),
    url:     z.string().min(12).max(32),
  }),
});

/** Full input passed to the SingleToolSpotlight composition root */
export const singleToolSpotlightInputSchema = z.object({
  /** Which slide to render (worker calls renderStill once per slideIndex) */
  slideIndex: z.number().int().min(0),
  /** Total slides — used to render counter "01 / 03" etc. */
  slideTotal: z.number().int().min(1),
  /** Slide-specific content. Cover and body have different shapes; only one
   * is populated per render call. */
  cover: coverPropsSchema.nullable(),
  body:  spotlightBodyPropsSchema.nullable(),
  /** End slide content (CTA + logo) — always populated for slideTotal > 1 */
  end: z.object({
    ctaLine: z.string().min(8).max(24),
    url:     z.string().min(12).max(32),
  }).nullable(),
  /** Theme + tokens at render time */
  theme:       z.enum(["dark", "light"]).default("dark"),
  locale:      z.enum(["de", "en"]).default("de"),
  brandTokens: z.record(z.unknown()).optional(),
  overrides:   z.record(z.unknown()).optional(),
});

export type CoverProps = z.infer<typeof coverPropsSchema>;
export type SpotlightBodyProps = z.infer<typeof spotlightBodyPropsSchema>;
export type SingleToolSpotlightInput = z.infer<typeof singleToolSpotlightInputSchema>;
