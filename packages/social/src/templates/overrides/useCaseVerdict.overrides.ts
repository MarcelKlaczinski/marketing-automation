import { z } from "zod";

export const useCaseVerdictOverridesSchema = z
  .object({
    copy: z
      .object({
        coverSlide: z
          .object({
            promiseLine1: z
              .object({
                de: z.string().default("Wer gewinnt für welchen Use-Case?"),
                en: z.string().default("Who wins which use case?"),
              })
              .default({}),
            promiseLine2: z
              .object({
                de: z.string().default("Klare Empfehlungen."),
                en: z.string().default("Clear recommendations."),
              })
              .default({}),
          })
          .default({}),
        verdictSlide: z
          .object({
            winnerLabel: z
              .object({ de: z.string().default("GEWINNT"), en: z.string().default("WINS") })
              .default({}),
          })
          .default({}),
        recapSlide: z
          .object({
            overallResultLabel: z
              .object({
                de: z.string().default("GESAMT-ERGEBNIS"),
                en: z.string().default("OVERALL RESULT"),
              })
              .default({}),
            whoWinsLabel: z
              .object({ de: z.string().default("Wer gewinnt?"), en: z.string().default("Who wins?") })
              .default({}),
            allVerdictsLabel: z
              .object({
                de: z.string().default("Alle Verdicts"),
                en: z.string().default("All verdicts"),
              })
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
                de: z.string().default("für deine nächste Use-Case-Entscheidung"),
                en: z.string().default("for your next use-case decision"),
              })
              .default({}),
            ctaFollowLabel: z
              .object({
                de: z.string().default("Mehr ehrliche Vergleiche"),
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
        includeRecapSlide: z.boolean().default(true),
        showSavePrompt: z.boolean().default(true),
        showFollowCTA: z.boolean().default(true),
        showArticleLink: z.boolean().default(true),
      })
      .default({}),
    eligibility: z
      .object({
        minVerdictsCount: z.number().int().min(2).max(10).default(3),
      })
      .default({}),
  })
  .strip();

export type UseCaseVerdictOverrides = z.infer<typeof useCaseVerdictOverridesSchema>;
