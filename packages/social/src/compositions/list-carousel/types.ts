import { z } from "zod";
import { comparisonGridOverridesSchema } from "../../templates/overrides/comparisonGrid.overrides.ts";

// Spec 60.0: brandTokensSchema moved to @marketing-auto/shared/brand-tokens.
// Re-exported here for back-compat — prefer importing from @marketing-auto/shared/brand-tokens in new code.
import { brandTokensSchema, type BrandTokens } from "@marketing-auto/shared/brand-tokens";
export { brandTokensSchema, type BrandTokens };

const toolSchema = z.object({
  slug: z.string(),
  rank: z.number().int(),
  name: z.string(),
  domain: z.string(),
  eyebrow: z.string().max(40).transform((s) => s.slice(0, 40)),
  tagline: z.string().max(120).transform((s) => s.slice(0, 120)),
  bestFor: z.string().max(40).transform((s) => s.slice(0, 40)).optional(),
  strengths: z.array(z.string().transform((s) => s.slice(0, 80))).min(2).max(4),
  pricing: z.object({
    tier: z.enum(["free", "freemium", "paid"]),
    label: z.string(),
  }),
  // Resolved icon — passed in by pipeline after icon-resolver lookup
  iconSvg: z.string().optional(),      // inline SVG from resolution chain (simple-icons/iconify/lobe-icons)
  iconInitials: z.string().optional(), // deterministic avatar fallback
  iconHue: z.number().optional(),
  // Stunning variant extras
  keyDifferentiator: z.string().max(60).optional(), // highlight phrase in tagline
  starStrength: z.string().max(80).optional(),       // first bullet gets star treatment
  // Spec 51a-stunning-v2.1 closer-engine enrichment tokens (also surfaced for caption/a11y)
  endSlideToken: z.string().optional(),
  identityVerb: z.string().optional(),
});

export type Tool = z.infer<typeof toolSchema>;

export const promiseBlockSchema = z.object({
  line1: z.string(),
  line2: z.string(),
});

export type PromiseBlock = z.infer<typeof promiseBlockSchema>;

export const hookOutputSchema = z.object({
  pattern: z.enum(["superlative_question", "number_promise", "negative_frame", "identity_frame", "curiosity_gap"]),
  leadPhrase: z.string(),
  highlightWord: z.string(),
  trailPhrase: z.string(),
  fullText: z.string(),
  promiseBlock: promiseBlockSchema,
});

export type HookOutput = z.infer<typeof hookOutputSchema>;

// Spec 51a-stunning-v2.1 §1.1 — structured closer (deterministic patterns,
// each line rendered as three independent JSX spans).
export const closerLineSchema = z.object({
  leadText: z.string(),
  highlightText: z.string(),
  trailText: z.string(),
});

export type CloserLine = z.infer<typeof closerLineSchema>;

export const endCloserSchema = z.object({
  pattern: z.enum(["verdict_recap", "action_frame", "identity_mirror", "open_comment"]),
  line1: closerLineSchema,
  line2: closerLineSchema,
  fullText: z.string(),
});

export type EndCloser = z.infer<typeof endCloserSchema>;

export const listCarouselInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["stunning"]).default("stunning"),
  locale: z.enum(["de", "en"]).default("de"),
  brandTokens: brandTokensSchema.default({}),
  slideIndex: z.number().int().default(0),

  cover: z.object({
    eyebrow: z.string().max(40),
    headlineLead: z.string().max(30),
    headlineHighlight: z.string().max(40),
    headlineTrail: z.string().max(20).optional(),
    subhead: z.string().max(80).optional(),
    // Stunning variant hook (v2 phrase-based)
    hookOutput: hookOutputSchema.optional(),
  }),

  tools: z.array(toolSchema).min(2).max(10),

  end: z.object({
    headline: z.string().max(40),
    headlineHighlight: z.string().max(40),
    articleUrl: z.string(),
    qrCodeUrl: z.string().optional(),
    // Stunning variant extras
    closer: endCloserSchema.optional(),
    toolRecap: z.array(z.string()).optional(), // tool slugs for recap strip
  }),
  // Spec 57.3 — project-scoped overrides; defaults applied when absent
  overrides: comparisonGridOverridesSchema.optional(),
});

export type ListCarouselInput = z.infer<typeof listCarouselInputSchema>;
