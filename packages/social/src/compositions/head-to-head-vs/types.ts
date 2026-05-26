/**
 * Spec 65.7 — `head-to-head-vs` 2-tool comparison carousel input schema.
 *
 * 6-slide anatomy:
 *   0 — Cover ("Tool A vs Tool B" + tools-glance)
 *   1 — Tool A profile (full-slide)
 *   2 — Tool B profile (full-slide)
 *   3 — Side-by-side compare slide (3 criteria, both tools at once)
 *   4 — Verdict (winner + reasoning)
 *   5 — End slide
 *
 * Brand-color hierarchy (Q7 default): primary tool gets full brand background;
 * secondary tool gets accent-stripe treatment in side-by-side + cover.
 */
import { z } from "zod";
import {
  familyACommonInputSchema,
  familyACoverSchema,
  familyAEndSchema,
  familyAToolSchema,
  familyAVerdictSchema,
} from "../_shared/family-a/types.ts";

export const headToHeadCompareSlideSchema = z.object({
  /** 3 criteria evaluated side-by-side between the two tools. */
  criteria: z
    .array(
      z.object({
        label: z.string().min(4).max(28),
        /** Verdict line for tool A on this criterion. */
        toolAVerdict: z.string().min(4).max(56),
        /** Verdict line for tool B on this criterion. */
        toolBVerdict: z.string().min(4).max(56),
        /** Which tool wins this row — "a" | "b" | "tie". */
        winner: z.enum(["a", "b", "tie"]),
      }),
    )
    .length(3),
});

export type HeadToHeadCompareSlideContent = z.infer<typeof headToHeadCompareSlideSchema>;

export const headToHeadVsInputSchema = z
  .object({
    slideIndex: z.number().int().min(0).default(0),
    slideTotal: z.number().int().min(1).default(6),
    cover: familyACoverSchema,
    /** Exactly 2 tools — Tool A (index 0) is the lead/primary, Tool B (index 1) is the challenger. */
    tools: z.array(familyAToolSchema).length(2),
    compare: headToHeadCompareSlideSchema,
    verdict: familyAVerdictSchema,
    end: familyAEndSchema,
    overrides: z.record(z.unknown()).optional(),
  })
  .merge(familyACommonInputSchema);

export type HeadToHeadVsInput = z.infer<typeof headToHeadVsInputSchema>;

export const headToHeadVsGeneratedSchema = z.object({
  cover: familyACoverSchema,
  compare: headToHeadCompareSlideSchema,
  verdict: familyAVerdictSchema,
  end: familyAEndSchema,
});

export type HeadToHeadVsGenerated = z.infer<typeof headToHeadVsGeneratedSchema>;

export const headToHeadVsBounds = {
  cover: {
    eyebrow: { min: 8, max: 36 },
    headlineLead: { min: 4, max: 28 },
    headlineEm: { min: 4, max: 32 },
    subline: { min: 40, max: 160 },
    headerNum: { min: 8, max: 48 },
  },
  tools: {
    count: 2,
    name: { min: 1, max: 28 },
    meta: { min: 1, max: 48 },
    pros: { count: 2, each: { min: 1, max: 60 } },
    cons: { count: 2, each: { min: 1, max: 60 } },
  },
  compare: {
    criteria: {
      count: 3,
      label: { min: 4, max: 28 },
      toolAVerdict: { min: 4, max: 56 },
      toolBVerdict: { min: 4, max: 56 },
    },
  },
  verdict: {
    eyebrow: { min: 6, max: 32 },
    reasoning: { min: 40, max: 220 },
    ctaLine: { min: 6, max: 28 },
  },
  end: {
    headlineLead: { min: 4, max: 28 },
    headlineEm: { min: 4, max: 32 },
    articleUrl: { min: 8, max: 48 },
    ctaLine: { min: 6, max: 28 },
  },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const;
