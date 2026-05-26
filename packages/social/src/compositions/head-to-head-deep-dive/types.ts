/**
 * Spec 65.7 — `head-to-head-deep-dive` 2-tool deep comparison carousel input schema.
 *
 * 9-slide anatomy:
 *   0 — Cover ("Tool A vs Tool B — Deep Dive")
 *   1 — Tool A profile (overview + key facts)
 *   2 — Tool A features (extended pros + cons)
 *   3 — Tool B profile (overview + key facts)
 *   4 — Tool B features (extended pros + cons)
 *   5 — Pricing-compare slide (side-by-side pricing)
 *   6 — Use-case-compare slide (3-5 use-cases, winner-per-row)
 *   7 — Verdict
 *   8 — End
 */
import { z } from "zod";
import {
  familyACommonInputSchema,
  familyACoverSchema,
  familyAEndSchema,
  familyAToolSchema,
  familyAVerdictSchema,
} from "../_shared/family-a/types.ts";

export const pricingCompareSchema = z.object({
  /** Eyebrow/label, e.g. "Pricing & Limits". */
  title: z.string().min(6).max(40),
  /** Per-tool pricing breakdown — 3 rows ("Plan name", "Cost", "Best for"). */
  rows: z
    .array(
      z.object({
        label: z.string().min(4).max(28),
        toolA: z.string().min(2).max(40),
        toolB: z.string().min(2).max(40),
      }),
    )
    .length(3),
});

export type PricingCompareContent = z.infer<typeof pricingCompareSchema>;

export const useCaseCompareSchema = z.object({
  /** Eyebrow/label, e.g. "Beste Wahl pro Use-Case". */
  title: z.string().min(6).max(40),
  /** 3-5 use-cases with one winner per row. */
  rows: z
    .array(
      z.object({
        label: z.string().min(4).max(36),
        /** Which tool wins this row — "a" or "b". */
        winner: z.enum(["a", "b"]),
        /** One-line reasoning. */
        reason: z.string().min(4).max(56),
      }),
    )
    .min(3)
    .max(5),
});

export type UseCaseCompareContent = z.infer<typeof useCaseCompareSchema>;

export const headToHeadDeepDiveInputSchema = z
  .object({
    slideIndex: z.number().int().min(0).default(0),
    slideTotal: z.number().int().min(1).default(9),
    cover: familyACoverSchema,
    /** Exactly 2 tools. Tool A (index 0) is primary, Tool B (index 1) is challenger. */
    tools: z.array(familyAToolSchema).length(2),
    pricing: pricingCompareSchema,
    useCases: useCaseCompareSchema,
    verdict: familyAVerdictSchema,
    end: familyAEndSchema,
    overrides: z.record(z.unknown()).optional(),
  })
  .merge(familyACommonInputSchema);

export type HeadToHeadDeepDiveInput = z.infer<typeof headToHeadDeepDiveInputSchema>;

export const headToHeadDeepDiveGeneratedSchema = z.object({
  cover: familyACoverSchema,
  pricing: pricingCompareSchema,
  useCases: useCaseCompareSchema,
  verdict: familyAVerdictSchema,
  end: familyAEndSchema,
});

export type HeadToHeadDeepDiveGenerated = z.infer<typeof headToHeadDeepDiveGeneratedSchema>;

export const headToHeadDeepDiveBounds = {
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
  pricing: {
    title: { min: 6, max: 40 },
    rows: { count: 3, label: { min: 4, max: 28 }, toolA: { min: 2, max: 40 }, toolB: { min: 2, max: 40 } },
  },
  useCases: {
    title: { min: 6, max: 40 },
    rows: { countMin: 3, countMax: 5, label: { min: 4, max: 36 }, reason: { min: 4, max: 56 } },
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
