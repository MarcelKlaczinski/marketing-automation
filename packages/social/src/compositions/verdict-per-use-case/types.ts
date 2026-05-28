import { z } from "zod";

// ─── Zod input schema for Remotion composition registration ──────────────────

export const verdictPerUseCaseInputSchema = z.object({
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
    useCases: z
      .array(
        z.object({
          label: z.string(),
          winnerName: z.string(),
          iconSvg: z.string().optional(),
          iconInitials: z.string().optional(),
          iconHue: z.number().optional(),
        }),
      )
      .min(5)
      .max(7),
  }),
  brandTokens: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
  /** Spec 65.15 — Cover-stamp logo URL; null/undefined → no stamp. */
  logoUrl: z.string().nullable().optional(),
});

export type VerdictPerUseCaseInput = z.infer<typeof verdictPerUseCaseInputSchema>;

// ─── Generated type ───────────────────────────────────────────────────────────

export type VerdictUseCase = VerdictPerUseCaseInput["generated"]["useCases"][number];
export type VerdictPerUseCaseGenerated = VerdictPerUseCaseInput["generated"];

// ─── generatedSchema (for fixture tests + TemplateDefinition) ─────────────────

export const verdictPerUseCaseGeneratedSchema = z.object({
  headline: z.string(),
  headlineEm: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slideNum: z.string(),
  ctaLine1: z.string(),
  ctaLine2: z.string(),
  dateLabel: z.string(),
  useCases: z
    .array(
      z.object({
        label: z.string(),
        winnerName: z.string(),
        iconSvg: z.string().optional(),
        iconInitials: z.string().optional(),
        iconHue: z.number().optional(),
      }),
    )
    .min(5)
    .max(7),
});

// ─── ContentBounds (authoritative source: REMOTION.md VerdictPerUseCaseProps) ─

export const verdictPerUseCaseBounds = {
  eyebrow:    { min: 10, max: 28 },   // REMOTION.md: min 10, max 28
  headerNum:  { min: 18, max: 56 },   // REMOTION.md: min 18, max 56
  heroTitle:  { min: 10, max: 32 },   // REMOTION.md: min 10, max 32
  heroSub:    { min: 50, max: 180 },  // REMOTION.md: min 50, max 180
  rows: {
    countMin: 5,
    countMax: 7,
    label:      { min: 8,  max: 28 }, // REMOTION.md: min 8, max 28
    winnerName: { min: 3,  max: 16 }, // REMOTION.md: min 3, max 16 (pill renders on one line)
  },
  footer: {
    ctaLine: { min: 8,  max: 30 },
    url:     { min: 12, max: 32 },
  },
  captionBody: { min: 20, max: 1800 },
  hashtags:    { max: 10, perItemMaxChars: 24 },
} as const;
