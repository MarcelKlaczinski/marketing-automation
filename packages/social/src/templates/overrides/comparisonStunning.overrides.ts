import { z } from "zod";

export const comparisonStunningOverridesSchema = z
  .object({
    copy: z
      .object({
        coverEyebrowLabel: z
          .object({
            de: z.string().default("TOOL-VERGLEICH"),
            en: z.string().default("TOOL COMPARISON"),
          })
          .default({}),
        deepDiveEyebrow: z
          .object({
            de: z.string().default("ZUR VERTIEFUNG"),
            en: z.string().default("DIVE DEEPER"),
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
                de: z.string().default("als Cheat-Sheet für deinen nächsten Tool-Vergleich"),
                en: z.string().default("as your tool-comparison cheat sheet"),
              })
              .default({}),
            ctaFollowLabel: z
              .object({
                de: z.string().default("Mehr ehrliche Vergleiche"),
                en: z.string().default("More honest reviews"),
              })
              .default({}),
            // Fix X: was hardcoded German in ToolSlideStunning.tsx
            perfektFürLabel: z
              .object({
                de: z.string().default("Perfekt für"),
                en: z.string().default("Perfect for"),
              })
              .default({}),
            // Fix X: was hardcoded German in EndSlideStunning.tsx
            toolsRecapLabel: z
              .object({
                de: z.string().default("Tools im Detail"),
                en: z.string().default("Tools in detail"),
              })
              .default({}),
            // Fix X: was hardcoded German "für " in EndSlideStunning.tsx
            forLabel: z
              .object({
                de: z.string().default("für "),
                en: z.string().default("for "),
              })
              .default({}),
          })
          .default({}),
      })
      .default({}),
    layout: z
      .object({
        includeEndSlide: z.boolean().default(true),
        showRankBadge: z.boolean().default(true),
        showPricingChip: z.boolean().default(true),
        showToolRecap: z.boolean().default(true),
        showSavePrompt: z.boolean().default(true),
        showFollowCTA: z.boolean().default(true),
        showArticleLink: z.boolean().default(true),
      })
      .default({}),
    eligibility: z.object({}).default({}),
  })
  .strip();

export type ComparisonStunningOverrides = z.infer<typeof comparisonStunningOverridesSchema>;
