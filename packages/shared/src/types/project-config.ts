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

// ─────────────────────────────────────────────────────────────────────────────
// Star-Trend Story detection knobs (Spec 64.21)
//
// Stored in `project_planner_config.star_trend_config` JSONB (migration 0111).
// Same partial-override pattern as trendScoreWeights — NULL column = use all
// defaults; partial objects merge field-by-field. See `resolveStarTrendConfig`.
//
// Detection rule (`detectStarTrend` in packages/pipelines/src/topic-sources/star-trend/detect.ts):
//   absoluteHit = (current - prior) >= absoluteThreshold
//   relativeHit = (current - prior) / prior * 100 >= relativeThresholdPct
//                 AND current >= minAbsoluteForRelative
//   triggered   = absoluteHit OR relativeHit
//
// `windowDays` controls how far back the worker looks for the prior snapshot —
// `queryStarsAgo(inventoryId, NOW - windowDays)` returns the most recent
// snapshot at-or-before that cutoff. With weekly refresh (default), windowDays:30
// gives 4 snapshots to compare against. `weeklyCap` paces the brief emission
// (same convention as RELEASE_DETECTION_WEEKLY_CAP=5 in 64.20 A3).
//
// ⚠️  DO NOT add `.default(...)` at the field level — same rationale as
// trendScoreWeightsSchema above (would break the partial-override JSONB roundtrip
// AND the "all-defaults → NULL" payload optimisation).
export const starTrendConfigSchema = z
  .object({
    absoluteThreshold:      z.number().int().min(1).optional(),
    relativeThresholdPct:   z.number().int().min(1).max(10_000).optional(),
    minAbsoluteForRelative: z.number().int().min(0).optional(),
    weeklyCap:              z.number().int().min(0).max(50).optional(),
    windowDays:             z.number().int().min(1).max(365).optional(),
  })
  .strict()
  .describe(
    "Per-project star-trend detection override. Each knob defaults to the DEFAULT_STAR_TREND_CONFIG constant when omitted. Stored as JSONB on project_planner_config.",
  );

export type StarTrendConfig = z.infer<typeof starTrendConfigSchema>;

/**
 * Fully-resolved shape with all five knobs required — what
 * `resolveStarTrendConfig()` returns and what the detect/emit modules consume.
 * Same `Resolved*` interface idiom as `ResolvedTrendScoreWeights` for
 * `exactOptionalPropertyTypes` narrowing.
 */
export interface ResolvedStarTrendConfig {
  absoluteThreshold: number;
  relativeThresholdPct: number;
  minAbsoluteForRelative: number;
  weeklyCap: number;
  windowDays: number;
}

/** Code defaults per Marcel-decision (Spec 64.21 §Decisions). */
export const DEFAULT_STAR_TREND_CONFIG: ResolvedStarTrendConfig = {
  absoluteThreshold:      5_000,
  relativeThresholdPct:   50,
  minAbsoluteForRelative: 500,
  weeklyCap:              3,
  windowDays:             30,
};

/** Merge override with defaults — used at detect time. */
export function resolveStarTrendConfig(
  override: StarTrendConfig | null | undefined,
): ResolvedStarTrendConfig {
  if (!override) return { ...DEFAULT_STAR_TREND_CONFIG };
  return {
    absoluteThreshold:      override.absoluteThreshold      ?? DEFAULT_STAR_TREND_CONFIG.absoluteThreshold,
    relativeThresholdPct:   override.relativeThresholdPct   ?? DEFAULT_STAR_TREND_CONFIG.relativeThresholdPct,
    minAbsoluteForRelative: override.minAbsoluteForRelative ?? DEFAULT_STAR_TREND_CONFIG.minAbsoluteForRelative,
    weeklyCap:              override.weeklyCap              ?? DEFAULT_STAR_TREND_CONFIG.weeklyCap,
    windowDays:             override.windowDays             ?? DEFAULT_STAR_TREND_CONFIG.windowDays,
  };
}
