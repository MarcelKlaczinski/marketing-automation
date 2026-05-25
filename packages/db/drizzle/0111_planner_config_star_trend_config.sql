-- Spec 64.21 — per-project override for star-trend detection knobs.
--
-- NULL column = use code defaults (DEFAULT_STAR_TREND_CONFIG):
--   { absoluteThreshold: 5000, relativeThresholdPct: 50,
--     minAbsoluteForRelative: 500, weeklyCap: 3, windowDays: 30 }
--
-- Partial overrides — Marcel can set just `absoluteThreshold` to override one
-- knob while inheriting the rest. Same pattern as Spec 64.19 / Phase D
-- (trend_score_weights). See resolveStarTrendConfig() helper in
-- packages/shared/src/types/star-trend-config.ts.

ALTER TABLE "project_planner_config"
  ADD COLUMN "star_trend_config" jsonb;
