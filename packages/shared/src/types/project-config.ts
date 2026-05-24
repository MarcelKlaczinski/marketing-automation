// Spec 64.14: per-project planner config types shared between API + planner +
// pipelines packages. Lives in shared so the planner Zod gate, the API route
// validator, and the SelectOverageItemsStep can all import it without crossing
// the cost-tracker / pipelines boundary.

import { z } from "zod";

/**
 * Planner content_type values that an external signal can be mapped to. Kept
 * in sync with `PLANNING_CONTENT_TYPES` in
 * `packages/pipelines/src/planning/types.ts` (Spec 64.1).
 *
 * Duplicated here on purpose: `@marketing-auto/shared` cannot depend on
 * `@marketing-auto/pipelines`. The values are stable enough (5 entries since
 * 64.1) that drift is unlikely; if a new content_type lands, extend both lists
 * in the same PR. The mismatch would surface in the Zod parse at the HTTP
 * boundary so the failure mode is loud, not silent.
 */
const SIGNAL_CONTENT_TYPE_VALUES = [
  "cluster",
  "cluster_spoke",
  "comparison",
  "social_post",
  "ki_wissen",
] as const;

export const signalSourceContentTypeMapSchema = z
  .record(z.string(), z.enum(SIGNAL_CONTENT_TYPE_VALUES).nullable())
  .describe(
    "Per-project override for inferContentTypeFromSignal. Source key absent = fall back to default. Value null = skip overage emission for that source.",
  );

export type SignalSourceContentTypeMap = z.infer<
  typeof signalSourceContentTypeMapSchema
>;

// ─── Spec 64.19 / Phase D — per-project trend score weights override ─────────
//
// Mirrors the `W` constant in
// `packages/pipelines/src/topic-sources/trend-discovery/score.ts:12`. Partial
// override pattern: any unset knob falls back to the hardcoded default in
// `score.ts` at compute time. NULL column or `{}` value = use all defaults.
//
// Defaults (54.5b rebalance, positive weights sum to 100):
//   buzz=15, growth=15, official=25, serp=20, diversity=25, coverage=40
// `coverage` is the existing-coverage *penalty*, subtracted from the sum.
//
// Stored in `project_planner_config.trend_score_weights` JSONB (migration 0104).
//
// ⚠️  DO NOT add `.default(...)` at the field level.
// Field-level defaults must stay applied by `resolveTrendScoreWeights()` via
// the `?? defaults.X` operator, NOT via Zod parsing. Adding `.default()` here
// would cause:
//   (a) the partial-JSONB roundtrip to fill in defaults on save, silently
//       pinning the project to the current code defaults (a later code-default
//       change in score.ts would no longer auto-apply on that project);
//   (b) the `buildTrendScoreWeightsPayload()` "all-defaults → null"
//       optimisation in SettingsPlannerPage.vue to break (the stored object
//       would carry default values, defeating the NULL-means-defaults
//       contract).
export const trendScoreWeightsSchema = z
  .object({
    buzz: z.number().min(0).max(100).optional(),
    growth: z.number().min(0).max(100).optional(),
    official: z.number().min(0).max(100).optional(),
    serp: z.number().min(0).max(100).optional(),
    diversity: z.number().min(0).max(100).optional(),
    coverage: z.number().min(0).max(100).optional(),
  })
  .strict()
  .describe(
    "Per-project trend-score weight override. Each knob defaults to the score.ts W constant when omitted. Stored as JSONB on project_planner_config.",
  );

export type TrendScoreWeights = z.infer<typeof trendScoreWeightsSchema>;

/**
 * Fully-resolved shape with all six knobs required — what
 * `resolveTrendScoreWeights()` returns and what `score.ts` consumes. Distinct
 * from `TrendScoreWeights` (the partial override shape stored in JSONB) so
 * TypeScript narrows the post-resolve type correctly under
 * `exactOptionalPropertyTypes` (`Required<>` alone doesn't strip
 * `undefined` from Zod-inferred optionals).
 */
export interface ResolvedTrendScoreWeights {
  buzz: number;
  growth: number;
  official: number;
  serp: number;
  diversity: number;
  coverage: number;
}

/** Default weights from score.ts W constant (Spec 54.5b rebalance). */
export const DEFAULT_TREND_SCORE_WEIGHTS: ResolvedTrendScoreWeights = {
  buzz: 15,
  growth: 15,
  official: 25,
  serp: 20,
  diversity: 25,
  coverage: 40,
};

/** Merge override with defaults — used at score-compute time. */
export function resolveTrendScoreWeights(
  override: TrendScoreWeights | null | undefined,
): ResolvedTrendScoreWeights {
  if (!override) return { ...DEFAULT_TREND_SCORE_WEIGHTS };
  // Drop `undefined` entries from the override so they don't shadow the
  // default values via the spread. Zod's optional fields can serialize as
  // `undefined` for missing keys, and spreading those would erase the default.
  return {
    buzz: override.buzz ?? DEFAULT_TREND_SCORE_WEIGHTS.buzz,
    growth: override.growth ?? DEFAULT_TREND_SCORE_WEIGHTS.growth,
    official: override.official ?? DEFAULT_TREND_SCORE_WEIGHTS.official,
    serp: override.serp ?? DEFAULT_TREND_SCORE_WEIGHTS.serp,
    diversity: override.diversity ?? DEFAULT_TREND_SCORE_WEIGHTS.diversity,
    coverage: override.coverage ?? DEFAULT_TREND_SCORE_WEIGHTS.coverage,
  };
}
