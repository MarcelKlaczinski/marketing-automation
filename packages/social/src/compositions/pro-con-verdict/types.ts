import { z } from "zod";

// ─── LLM raw response schema (snake_case) ─────────────────────────────────────

export const proConVerdictLlmResponseSchema = z.object({
  tool_name: z.string(),
  tool_category: z.string(),
  tool_logo_slug: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slide_num: z.string(),
  cta_line1: z.string(),
  cta_line2: z.string(),
  date_label: z.string(),
  pros_header: z.string(),
  cons_header: z.string(),
  pros: z.array(z.string()).min(3).max(4),
  cons: z.array(z.string()).min(3).max(4),
  verdict_text: z.string(),
  verdict_em: z.string(),
  recommendation_tag: z.string(),
  caption: z.string().min(20).max(1800),
  hashtags: z.array(z.string().regex(/^#[^\s\-#]+$/u)).min(5).max(10),
});

export type ProConVerdictLlmResponse = z.infer<typeof proConVerdictLlmResponseSchema>;

// ─── Generated (camelCase) ────────────────────────────────────────────────────

export interface ProConVerdictGenerated {
  toolName: string;
  toolCategory: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
  subline: string;
  eyebrow: string;
  slideNum: string;
  ctaLine1: string;
  ctaLine2: string;
  dateLabel: string;
  prosHeader: string;
  consHeader: string;
  pros: string[];
  cons: string[];
  verdictText: string;
  verdictEm: string;
  recommendationTag: string;
}

// ─── generatedSchema (camelCase, for fixture tests + TemplateDefinition) ──────

export const proConVerdictGeneratedSchema = z.object({
  toolName: z.string(),
  toolCategory: z.string(),
  iconSvg: z.string().optional(),
  iconInitials: z.string().optional(),
  iconHue: z.number().optional(),
  subline: z.string(),
  eyebrow: z.string(),
  slideNum: z.string(),
  ctaLine1: z.string(),
  ctaLine2: z.string(),
  dateLabel: z.string(),
  prosHeader: z.string(),
  consHeader: z.string(),
  pros: z.array(z.string()).min(3).max(4),
  cons: z.array(z.string()).min(3).max(4),
  verdictText: z.string(),
  verdictEm: z.string(),
  recommendationTag: z.string(),
});

export type ProConVerdictGeneratedType = z.infer<typeof proConVerdictGeneratedSchema>;

// ─── Zod input schema for Remotion composition registration ──────────────────

export const proConVerdictInputSchema = z.object({
  slideIndex: z.number().int().default(0),
  locale: z.enum(["de", "en"]).default("de"),
  theme: z.enum(["dark", "light"]).default("dark"),
  generated: proConVerdictGeneratedSchema,
  brandTokens: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
});

export type ProConVerdictInput = z.infer<typeof proConVerdictInputSchema>;

// ─── ContentBounds ─────────────────────────────────────────────────────────────

export const proConVerdictBounds = {
  tool_name: { max: 28 },
  tool_category: { max: 26 },
  subline: { max: 110 },
  eyebrow: { max: 36 },
  slide_num: { max: 10 },
  cta_line1: { max: 28 },
  cta_line2: { max: 30 },
  date_label: { max: 36 },
  pros_header: { max: 16 },
  cons_header: { max: 16 },
  pros: { countMin: 3, countMax: 4, each: { max: 48 } },
  cons: { countMin: 3, countMax: 4, each: { max: 48 } },
  verdict_text: { max: 120 },
  verdict_em: { max: 20 },
  recommendation_tag: { max: 52 },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const;
