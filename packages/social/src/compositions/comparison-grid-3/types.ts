/**
 * Spec 65.7 — `comparison-grid-3` multi-slide carousel input schema.
 *
 * REPLACES the previous single-still anatomy. New carousel structure:
 *   slide 0 — Cover (LLM-generated headline + tools-glance)
 *   slide 1 — Compare-Header (criteria the comparison evaluates against)
 *   slides 2–4 — Tool slides (one per tool, ranked)
 *   slide 5 — Verdict (LLM-generated winner reasoning)
 *   slide 6 — End slide (CTA + URL)
 *
 * Total = 7 slides. Theme + locale + brandTokens flow as top-level fields
 * shared with all other Family A templates via `familyACommonInputSchema`.
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

// ─── Composition input schema ─────────────────────────────────────────────────

export const comparisonGrid3InputSchema = z
  .object({
    /** Which slide to render. Worker calls renderStill once per slideIndex. */
    slideIndex: z.number().int().min(0).default(0),
    /** Total slides — used to render counter "01 / 07" etc. */
    slideTotal: z.number().int().min(1).default(7),
    cover: familyACoverSchema,
    compareHeader: familyACompareHeaderSchema,
    /** Exactly 3 ranked tools (winner-first display order). */
    tools: z.array(familyAToolSchema).length(3),
    verdict: familyAVerdictSchema,
    end: familyAEndSchema,
    overrides: z.record(z.unknown()).optional(),
  })
  .merge(familyACommonInputSchema);

export type ComparisonGrid3Input = z.infer<typeof comparisonGrid3InputSchema>;

// ─── Generated schema (for fixture tests) ─────────────────────────────────────
//
// Spec 59.3.5 dual-schema convention: `generatedSchema` exists only for
// fixture-test invariants — it documents the slice of input that comes from
// the LLM and is used by `fixtures-respect-bounds.test.ts`. The full schema
// above stays the source of truth for runtime parsing.
export const comparisonGrid3GeneratedSchema = z.object({
  cover: familyACoverSchema,
  compareHeader: familyACompareHeaderSchema,
  verdict: familyAVerdictSchema,
  end: familyAEndSchema,
});

export type ComparisonGrid3Generated = z.infer<typeof comparisonGrid3GeneratedSchema>;

// ─── ContentBounds (authoritative: REMOTION.md — comparison-grid-3 section) ────

export const comparisonGrid3Bounds = {
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
    count: 3,
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
