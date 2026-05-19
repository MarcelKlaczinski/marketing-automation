import { z } from "zod";

export const comparisonGrid3OverridesSchema = z
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
            de: z.string().default("Workflow-Empfehlungen →"),
            en: z.string().default("Workflow recommendations →"),
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
        minToolCount: z.number().int().min(3).default(3),
      })
      .default({}),
  })
  .strip();

export type ComparisonGrid3Overrides = z.infer<typeof comparisonGrid3OverridesSchema>;
