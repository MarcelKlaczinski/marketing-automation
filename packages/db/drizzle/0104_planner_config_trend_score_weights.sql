-- Spec 64.19 / Phase D — per-project trend-score weight overrides.
--
-- `computeTrendScore()` in packages/pipelines/src/topic-sources/trend-discovery/score.ts
-- currently uses hardcoded weights (W = {buzz:15, growth:15, official:25, serp:20,
-- diversity:25, coverage:40}). Multi-Domain readiness: each tenant may need different
-- weights (e.g. Balkon-Kraftwerk niche differs from Toolwiki). Stored as JSONB so
-- partial overrides are supported — any unset knob falls back to the hardcoded default
-- at score-compute time. `NULL` column = use all defaults.
--
-- Pairs with the existing `signal_source_content_type_map` jsonb extension pattern
-- (Spec 64.14): additive nullable column, no DDL changes on the schema-level Zod
-- validator beyond a new `trend_score_weights` field with `.optional().nullable()`.

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "trend_score_weights" jsonb;

COMMENT ON COLUMN "project_planner_config"."trend_score_weights" IS
  'Spec 64.19 / Phase D — Partial<TrendScoreWeights> override. NULL = use code defaults from score.ts W constant.';
