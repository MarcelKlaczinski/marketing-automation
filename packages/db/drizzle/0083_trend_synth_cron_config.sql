-- Spec 63.4: per-project trend-synthesizer cron-trigger config on
-- project_planner_config.
--
-- Triggers handleSynthesizeProject() on the configured cadence. Unlike the
-- 62.7 (planner) and 63.3b (comparison-discovery) crons, the trend-synthesizer
-- supports BOTH daily AND weekly cadence:
--   - trend_synth_cron_day_of_week IS NULL → daily ("0 H * * *")
--   - 0..6                                  → weekly  ("0 H * * DOW")
--
-- Default daily 01:00 UTC (60 min after the signal-collectors at 00:30 UTC) so
-- fresh signals from HN/PH/Vendor-RSS get synthesized into briefs the same
-- day. Default OFF — Marcel toggles in SettingsPlannerPage.
--
-- The cron_job_type enum value 'trends_synthesizer' (note: plural) pre-exists
-- since Spec 56.6 so no enum-widening migration is needed. Per-project
-- cron_state rows are seeded at worker startup via seedTrendSynthesizerCron()
-- and on project create via routes/projects.ts.

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "trend_synth_cron_enabled"     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trend_synth_cron_day_of_week" integer
    CHECK ("trend_synth_cron_day_of_week" IS NULL OR "trend_synth_cron_day_of_week" BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS "trend_synth_cron_hour_utc"    integer NOT NULL DEFAULT 1
    CHECK ("trend_synth_cron_hour_utc" BETWEEN 0 AND 23);

COMMENT ON COLUMN "project_planner_config"."trend_synth_cron_day_of_week"
  IS 'NULL = daily; 0=Sunday..6=Saturday. Default NULL (daily).';
COMMENT ON COLUMN "project_planner_config"."trend_synth_cron_hour_utc"
  IS 'Hour of day UTC, 0-23. Default 1 (01:00 UTC, ~30 min after signal-collectors).';
