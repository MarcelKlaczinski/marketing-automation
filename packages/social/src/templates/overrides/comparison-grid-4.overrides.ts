import { z } from "zod";

export const comparisonGrid4OverridesSchema = z
  .object({
    copy: z
      .object({
        winnerFlagText: z
          .object({
            de: z.string().default("Testsieger"),
            en: z.string().default("Top pick"),
          })
          .default({}),
        ctaPrefix: z
          .object({
            de: z.string().default("Vollständiger Test →"),
            en: z.string().default("Full review →"),
          })
          .default({}),
        eyebrowPrefix: z
          .object({
            de: z.string().default("Vergleich ·"),
            en: z.string().default("Comparison ·"),
          })
          .default({}),
      })
      .default({}),
    eligibility: z
      .object({
        minToolCount: z.number().int().min(4).default(4),
      })
      .default({}),
  })
  .strip();

export type ComparisonGrid4Overrides = z.infer<typeof comparisonGrid4OverridesSchema>;
