import { z } from "zod";

// ─── Score colour tier ────────────────────────────────────────────────────────

export type ScoreTier = "hi" | "mid" | "lo";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "hi";
  if (score >= 65) return "mid";
  return "lo";
}

// ─── LLM raw response schema (snake_case) ────────────────────────────────────

export const comparisonGrid4LlmResponseSchema = z.object({
  headline: z.string(),
  headline_em: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slide_num: z.string(),
  cta_line1: z.string(),
  cta_line2: z.string(),
  date_label: z.string(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        verdict_strong: z.string(),
        verdict_rest: z.string(),
        score: z.number().int().min(0).max(100),
        price_label: z.string(),
        logo_slug: z.string(),
        is_winner: z.boolean(),
        winner_flag_text: z.string().optional(),
      }),
    )
    .length(4),
});

export type ComparisonGrid4LlmResponse = z.infer<typeof comparisonGrid4LlmResponseSchema>;

// ─── Generated (camelCase, post-transform) ────────────────────────────────────

export interface ComparisonGrid4Tool {
  name: string;
  verdictStrong: string;
  verdictRest: string;
  score: number;
  scoreTier: ScoreTier;
  priceLabel: string;
  isWinner: boolean;
  winnerFlagText?: string;
  // Icon resolution (populated by definition's buildInput/render)
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

export interface ComparisonGrid4Generated {
  headline: string;
  headlineEm: string;
  subline: string;
  eyebrow: string;
  slideNum: string;
  ctaLine1: string;
  ctaLine2: string;
  dateLabel: string;
  tools: ComparisonGrid4Tool[];
}

// ─── Zod schema for Remotion registration ─────────────────────────────────────

export const comparisonGrid4InputSchema = z.object({
  slideIndex: z.number().int().default(0),
  locale: z.enum(["de", "en"]).default("de"),
  theme: z.enum(["dark", "light"]).default("dark"),
  generated: z.object({
    headline: z.string(),
    headlineEm: z.string(),
    subline: z.string(),
    eyebrow: z.string(),
    slideNum: z.string(),
    ctaLine1: z.string(),
    ctaLine2: z.string(),
    dateLabel: z.string(),
    tools: z
      .array(
        z.object({
          name: z.string(),
          verdictStrong: z.string(),
          verdictRest: z.string(),
          score: z.number(),
          scoreTier: z.enum(["hi", "mid", "lo"]),
          priceLabel: z.string(),
          isWinner: z.boolean(),
          winnerFlagText: z.string().optional(),
          iconSvg: z.string().optional(),
          iconInitials: z.string().optional(),
          iconHue: z.number().optional(),
        }),
      )
      .length(4),
  }),
  brandTokens: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
});

// ─── generatedSchema (camelCase, for fixture tests + TemplateDefinition) ──────

export const comparisonGrid4GeneratedSchema = z.object({
  headline: z.string(),
  headlineEm: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slideNum: z.string(),
  ctaLine1: z.string(),
  ctaLine2: z.string(),
  dateLabel: z.string(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        verdictStrong: z.string(),
        verdictRest: z.string(),
        score: z.number(),
        scoreTier: z.enum(["hi", "mid", "lo"]),
        priceLabel: z.string(),
        isWinner: z.boolean(),
        winnerFlagText: z.string().optional(),
        iconSvg: z.string().optional(),
        iconInitials: z.string().optional(),
        iconHue: z.number().optional(),
      }),
    )
    .length(4),
});

export type ComparisonGrid4GeneratedSchema = z.infer<typeof comparisonGrid4GeneratedSchema>;

// ─── Composition input type (derived from Zod schema for Remotion compat) ─────

export type ComparisonGrid4Input = z.infer<typeof comparisonGrid4InputSchema>;

// ─── ContentBounds (authoritative: REMOTION.md Grid4Props) ───────────────────
// Field names match REMOTION.md — render internals (headline/subline/etc.) may differ.

export const comparisonGrid4Bounds = {
  eyebrow:   { min: 14, max: 32 },
  headerNum: { min: 14, max: 44 },
  heroTitle: { min: 12, max: 44 },
  heroSub:   { min: 60, max: 180 },
  tools: {
    count:    4,
    name:     { min: 3,  max: 16 },
    verdict:  { min: 30, max: 80 },
    price:    { min: 6,  max: 22 },
    flagText: { min: 6,  max: 14 },
  },
  footer: {
    ctaLine: { min: 8,  max: 24 },
    url:     { min: 12, max: 32 },
  },
  // Caption/hashtag fields (not rendered on slide)
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const;

// ─── Transform (snake_case LLM → camelCase Generated) ─────────────────────────

export function transformLlmResponse(
  raw: ComparisonGrid4LlmResponse,
): Omit<ComparisonGrid4Generated, "tools"> & { tools: Omit<ComparisonGrid4Tool, "iconSvg" | "iconInitials" | "iconHue">[] } {
  return {
    headline: raw.headline,
    headlineEm: raw.headline_em,
    subline: raw.subline,
    eyebrow: raw.eyebrow,
    slideNum: raw.slide_num,
    ctaLine1: raw.cta_line1,
    ctaLine2: raw.cta_line2,
    dateLabel: raw.date_label,
    tools: raw.tools.map((t) => ({
      name: t.name,
      verdictStrong: t.verdict_strong,
      verdictRest: t.verdict_rest,
      score: t.score,
      scoreTier: scoreTier(t.score),
      priceLabel: t.price_label,
      isWinner: t.is_winner,
      ...(t.winner_flag_text !== undefined && { winnerFlagText: t.winner_flag_text }),
    })),
  };
}
