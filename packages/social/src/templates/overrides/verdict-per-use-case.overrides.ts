import { z } from "zod";

export const verdictPerUseCaseOverridesSchema = z
  .object({
    copy: z
      .object({
        eyebrow: z
          .object({
            de: z.string().default("Bestes Tool für …"),
            en: z.string().default("Best tool for …"),
          })
          .default({}),
        ctaPrefix: z
          .object({
            de: z.string().default("Vollständige Matrix →"),
            en: z.string().default("Full matrix →"),
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

export type VerdictPerUseCaseOverrides = z.infer<typeof verdictPerUseCaseOverridesSchema>;
