/**
 * Spec 65.7 — `comparison-grid-5` multi-slide carousel input schema.
 *
 * 9-slide anatomy:
 *   0 — Cover (LLM-generated headline + tools-glance)
 *   1 — Compare-Header (criteria the comparison evaluates against)
 *   2–6 — Tool slides (one per tool, ranked winner-first)
 *   7 — Verdict (LLM-generated winner reasoning)
 *   8 — End slide (CTA + URL)
 *
 * Shares all slot shapes with `comparison-grid-3` via `_shared/family-a` —
 * the only delta is `tools.length === 5` and `slideTotal === 9`.
 */
import { z } from "zod";
import {
  familyACommonInputSchema,
  familyACompareHeaderSchema,
  familyACoverSchema,
  familyAEndSchema,
  familyAToolSchema,
  familyAVerdictSchema,
} from "../_shared/family-a/types.ts";

export const comparisonGrid5InputSchema = z
  .object({
    slideIndex: z.number().int().min(0).default(0),
    slideTotal: z.number().int().min(1).default(9),
    cover: familyACoverSchema,
    compareHeader: familyACompareHeaderSchema,
    /** Exactly 5 ranked tools (winner-first display order). */
    tools: z.array(familyAToolSchema).length(5),
    verdict: familyAVerdictSchema,
    end: familyAEndSchema,
    overrides: z.record(z.unknown()).optional(),
  })
  .merge(familyACommonInputSchema);

export type ComparisonGrid5Input = z.infer<typeof comparisonGrid5InputSchema>;

export const comparisonGrid5GeneratedSchema = z.object({
  cover: familyACoverSchema,
  compareHeader: familyACompareHeaderSchema,
  verdict: familyAVerdictSchema,
  end: familyAEndSchema,
});

export type ComparisonGrid5Generated = z.infer<typeof comparisonGrid5GeneratedSchema>;

export const comparisonGrid5Bounds = {
  cover: {
    eyebrow: { min: 8, max: 36 },
    headlineLead: { min: 4, max: 28 },
    headlineEm: { min: 4, max: 32 },
    subline: { min: 40, max: 160 },
    headerNum: { min: 8, max: 48 },
  },
  compareHeader: {
    title: { min: 10, max: 72 },
    criteria: { countMin: 2, countMax: 5, each: { min: 4, max: 40 } },
  },
  tools: {
    count: 5,
    name: { min: 1, max: 28 },
    meta: { min: 1, max: 48 },
    pros: { count: 2, each: { min: 1, max: 60 } },
    cons: { count: 2, each: { min: 1, max: 60 } },
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
