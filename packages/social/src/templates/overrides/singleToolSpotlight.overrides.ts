import { z } from "zod";

export const singleToolSpotlightOverridesSchema = z
  .object({
    copy: z
      .object({
        coverSlide: z
          .object({
            hookQuestion: z
              .object({
                de: z.string().default("lohnt es sich?"),
                en: z.string().default("worth it?"),
              })
              .default({}),
            promiseLine1: z
              .object({
                de: z.string().default("Stärken & Schwächen"),
                en: z.string().default("Strengths & weaknesses"),
              })
              .default({}),
            promiseLine2: z
              .object({
                de: z.string().default("Ehrlich. Ohne Hype."),
                en: z.string().default("No hype answers."),
              })
              .default({}),
          })
          .default({}),
        strengthsSlide: z
          .object({
            strengthsEyebrow: z
              .object({ de: z.string().default("STÄRKEN"), en: z.string().default("STRENGTHS") })
              .default({}),
            topStrengthLabel: z
              .object({ de: z.string().default("Top-Stärke"), en: z.string().default("Top strength") })
              .default({}),
            weaknessesLabel: z
              .object({ de: z.string().default("Schwächen"), en: z.string().default("Weaknesses") })
              .default({}),
          })
          .default({}),
        pricingSlide: z
          .object({
            pricingEyebrow: z
              .object({
                de: z.string().default("PRICING & FÜR WEN"),
                en: z.string().default("PRICING & FOR WHOM"),
              })
              .default({}),
            forWhomLabel: z
              .object({ de: z.string().default("Perfekt für"), en: z.string().default("Perfect for") })
              .default({}),
            skipIfLabel: z
              .object({
                de: z.string().default("Weniger geeignet wenn…"),
                en: z.string().default("Skip if…"),
              })
              .default({}),
          })
          .default({}),
        useCaseSlide: z
          .object({
            useCasesHeadline: z
              .object({ de: z.string().default("Wofür?"), en: z.string().default("Best for?") })
              .default({}),
          })
          .default({}),
        endSlide: z
          .object({
            ctaSaveLabel: z
              .object({
                de: z.string().default("Speichere diesen Post"),
                en: z.string().default("Save this post"),
              })
              .default({}),
            ctaSaveSubline: z
              .object({
                de: z.string().default("für deinen nächsten Tool-Check"),
                en: z.string().default("for your next tool check"),
              })
              .default({}),
            ctaFollowLabel: z
              .object({
                de: z.string().default("Mehr ehrliche Reviews"),
                en: z.string().default("More honest reviews"),
              })
              .default({}),
          })
          .default({}),
      })
      .default({}),
    layout: z
      .object({
        includeEndSlide: z.boolean().default(true),
        showSavePrompt: z.boolean().default(true),
        showFollowCTA: z.boolean().default(true),
        showArticleLink: z.boolean().default(true),
        showPricingChip: z.boolean().default(true),
      })
      .default({}),
    eligibility: z
      .object({
        minProsCount: z.number().int().min(1).max(10).default(2),
        maxProsCount: z.number().int().min(1).max(10).default(5),
        useCaseSlideThreshold: z.number().int().min(0).max(10).default(3),
      })
      .default({})
      .refine((v) => v.minProsCount <= v.maxProsCount, {
        message: "minProsCount must be ≤ maxProsCount",
      }),
  })
  .strip();

export type SingleToolSpotlightOverrides = z.infer<typeof singleToolSpotlightOverridesSchema>;
