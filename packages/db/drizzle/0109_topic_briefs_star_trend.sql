-- Spec 64.21 — Star-Trend Story brief source.
--
-- The GitHub-inventory refresh worker writes a star-count snapshot to
-- `inventory_star_history` on every successful refresh (cf. 0110). After the
-- snapshot is persisted, the worker compares the current row's star-count
-- against the snapshot from N days ago (default 30, configurable via
-- `project_planner_config.star_trend_config.windowDays`). When either
-- (a) absolute_delta >= absoluteThreshold (default 5000)
-- OR
-- (b) relative_delta >= relativeThresholdPct (default 50%) AND
--     current_stars >= minAbsoluteForRelative (default 500)
-- the worker emits a news-style topic_brief with source='star_trend' and a
-- populated star_trend_metadata bucket.
--
-- Pacing: max 3 briefs/week per project (configurable via star_trend_config.weeklyCap).
-- Mirror to release-detection (0107) — excess silently dropped, no
-- rejected_topic_candidates row.

-- 1. Widen topic_briefs.source CHECK to admit the new value. Same pattern as
--    0107 (release_detection) — DROP + ADD because PostgreSQL has no
--    ALTER CONSTRAINT for CHECK predicates.
ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_source_check";
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_source_check" CHECK ("source" IN (
    'gap_analysis',
    'trend_discovery',
    'refresh_detection',
    'manual',
    'comparison_discovery',
    'release_detection',
    'star_trend'
  ));

-- 2. New typed-bucket jsonb column for star-trend metadata.
ALTER TABLE "topic_briefs"
  ADD COLUMN "star_trend_metadata" jsonb;
