import { z } from "zod";

export const proConVerdictOverridesSchema = z
  .object({
    copy: z
      .object({
        eyebrow: z
          .object({
            de: z.string().default("Pro & Contra · Tool-Verdict"),
            en: z.string().default("Pros & Cons · Tool Verdict"),
          })
          .default({}),
        prosHeader: z
          .object({
            de: z.string().default("Stärken"),
            en: z.string().default("Strengths"),
          })
          .default({}),
        consHeader: z
          .object({
            de: z.string().default("Schwächen"),
            en: z.string().default("Weaknesses"),
          })
          .default({}),
        ctaPrefix: z
          .object({
            de: z.string().default("Vollständiger Test →"),
            en: z.string().default("Full review →"),
          })
          .default({}),
      })
      .default({}),
    layout: z.object({}).default({}),
    eligibility: z
      .object({
        minToolCount: z.number().int().min(1).default(1),
      })
      .default({}),
  })
  .strip();

export type ProConVerdictOverrides = z.infer<typeof proConVerdictOverridesSchema>;
