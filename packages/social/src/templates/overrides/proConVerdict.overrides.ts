import { z } from "zod";

export const proConVerdictOverridesSchema = z
  .object({
    copy: z
      .object({
        coverEyebrow: z
          .object({
            de: z.string().default("BEWERTUNG"),
            en: z.string().default("REVIEW"),
          })
          .default({}),
        prosHeader: z
          .object({
            de: z.string().default("VORTEILE"),
            en: z.string().default("PROS"),
          })
          .default({}),
        consHeader: z
          .object({
            de: z.string().default("NACHTEILE"),
            en: z.string().default("CONS"),
          })
          .default({}),
        verdictEyebrow: z
          .object({
            de: z.string().default("VERDIKT"),
            en: z.string().default("VERDICT"),
          })
          .default({}),
        whenToUseLabel: z
          .object({
            de: z.string().default("WANN NUTZEN"),
            en: z.string().default("WHEN TO USE"),
          })
          .default({}),
        whenToSkipLabel: z
          .object({
            de: z.string().default("WANN NICHT"),
            en: z.string().default("WHEN TO SKIP"),
          })
          .default({}),
        endCtaText: z
          .object({
            de: z.string().default("Mehr im Artikel"),
            en: z.string().default("Read the full article"),
          })
          .default({}),
      })
      .default({}),
    layout: z
      .object({
        includeEndSlide: z.boolean().default(true),
        showToolLogoOnCover: z.boolean().default(true),
        showToolLogoOnVerdict: z.boolean().default(true),
        coverSplitDirection: z
          .enum(["diagonal", "vertical", "horizontal"])
          .default("diagonal"),
        backgroundIntensity: z.enum(["subtle", "medium", "strong"]).default("medium"),
      })
      .default({}),
    eligibility: z
      .object({
        minPros: z.number().int().min(2).max(8).default(3),
        maxPros: z.number().int().min(3).max(8).default(5),
        minCons: z.number().int().min(2).max(8).default(3),
        maxCons: z.number().int().min(3).max(8).default(5),
      })
      .default({}),
  })
  .strip();

export type ProConVerdictOverrides = z.infer<typeof proConVerdictOverridesSchema>;
