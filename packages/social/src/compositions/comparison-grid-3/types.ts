import { z } from "zod";

// ─── Score colour tier ────────────────────────────────────────────────────────

export type ScoreTier = "hi" | "mid" | "lo";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "hi";
  if (score >= 65) return "mid";
  return "lo";
}

// ─── LLM raw response schema (snake_case) ────────────────────────────────────

export const comparisonGrid3LlmResponseSchema = z.object({
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
        meta: z.string(),
        score: z.number().int().min(0).max(100),
        price_prefix: z.string(),
        price_amount: z.string(),
        logo_slug: z.string(),
        is_winner: z.boolean(),
        winner_flag_text: z.string().optional(),
        pros: z.array(z.string()).length(2),
        cons: z.array(z.string()).length(2),
      }),
    )
    .length(3),
});

export type ComparisonGrid3LlmResponse = z.infer<typeof comparisonGrid3LlmResponseSchema>;

// ─── Zod input schema for Remotion composition registration ──────────────────

export const comparisonGrid3InputSchema = z.object({
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
          meta: z.string(),
          score: z.number(),
          scoreTier: z.enum(["hi", "mid", "lo"]),
          pricePrefix: z.string(),
          priceAmount: z.string(),
          isWinner: z.boolean(),
          winnerFlagText: z.string().optional(),
          pros: z.tuple([z.string(), z.string()]),
          cons: z.tuple([z.string(), z.string()]),
          iconSvg: z.string().optional(),
          iconInitials: z.string().optional(),
          iconHue: z.number().optional(),
        }),
      )
      .length(3),
  }),
  brandTokens: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
});

export type ComparisonGrid3Input = z.infer<typeof comparisonGrid3InputSchema>;

// ─── generatedSchema (camelCase, for fixture tests + TemplateDefinition) ──────

export const comparisonGrid3GeneratedSchema = z.object({
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
        meta: z.string(),
        score: z.number(),
        scoreTier: z.enum(["hi", "mid", "lo"]),
        pricePrefix: z.string(),
        priceAmount: z.string(),
        isWinner: z.boolean(),
        winnerFlagText: z.string().optional(),
        pros: z.tuple([z.string(), z.string()]),
        cons: z.tuple([z.string(), z.string()]),
        iconSvg: z.string().optional(),
        iconInitials: z.string().optional(),
        iconHue: z.number().optional(),
      }),
    )
    .length(3),
});

export type ComparisonGrid3GeneratedSchema = z.infer<typeof comparisonGrid3GeneratedSchema>;

// ─── ContentBounds (authoritative: REMOTION.md Grid3Props) ───────────────────

export const comparisonGrid3Bounds = {
  eyebrow: { min: 14, max: 30 },
  headerNum: { min: 14, max: 44 },
  heroTitle: { min: 14, max: 40 },
  heroSub: { min: 60, max: 160 },
  tools: {
    count: 3,
    name: { min: 4, max: 18 },
    meta: { min: 12, max: 32 },
    priceLabel: { min: 4, max: 22 },
    bullets: {
      pros: { count: 2, each: { min: 14, max: 50 } },
      cons: { count: 2, each: { min: 14, max: 50 } },
    },
    flagText: { min: 6, max: 16 },
  },
  footer: {
    ctaLine: { min: 8, max: 24 },
    url: { min: 12, max: 32 },
  },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const;

// ─── Transform (snake_case LLM → camelCase Generated) ────────────────────────

export function transformLlmResponse(
  raw: ComparisonGrid3LlmResponse,
): Omit<ComparisonGrid3Input["generated"], "tools"> & {
  tools: Omit<
    ComparisonGrid3Input["generated"]["tools"][number],
    "iconSvg" | "iconInitials" | "iconHue"
  >[];
} {
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
      meta: t.meta,
      score: t.score,
      scoreTier: scoreTier(t.score),
      pricePrefix: t.price_prefix,
      priceAmount: t.price_amount,
      isWinner: t.is_winner,
      ...(t.winner_flag_text !== undefined && { winnerFlagText: t.winner_flag_text }),
      pros: [t.pros[0]!, t.pros[1]!] as [string, string],
      cons: [t.cons[0]!, t.cons[1]!] as [string, string],
    })),
  };
}
