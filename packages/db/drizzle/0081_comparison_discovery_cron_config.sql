-- Spec 63.3b: per-project comparison-discovery cron-trigger config on
-- project_planner_config.
--
-- Auto-triggers discoverComparisonPairs() once per week at the configured
-- day-of-week + hour-UTC. Default Sunday 06:00 UTC (= 12h before the default
-- planner_weekly_generation cron at Sunday 18:00 UTC, giving Marcel time to
-- review the freshly-discovered pending pairs before the plan run picks them
-- up). Default OFF — Marcel toggles in SettingsPlannerPage.
--
-- Per-project cron_state rows for 'comparison_discovery' are NOT seeded here.
-- They are seeded at worker startup via seedComparisonDiscoveryCron() (Memory
-- D124: PostgreSQL forbids using a freshly-added enum value in the session
-- that added it, so the cron_state INSERT must run AFTER 0080 commits).

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "comparison_cron_enabled"     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "comparison_cron_day_of_week" integer NOT NULL DEFAULT 0
    CHECK ("comparison_cron_day_of_week" BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS "comparison_cron_hour_utc"    integer NOT NULL DEFAULT 6
    CHECK ("comparison_cron_hour_utc" BETWEEN 0 AND 23);

COMMENT ON COLUMN "project_planner_config"."comparison_cron_day_of_week"
  IS '0=Sunday, 1=Monday, ..., 6=Saturday. Default 0 (Sunday).';
COMMENT ON COLUMN "project_planner_config"."comparison_cron_hour_utc"
  IS 'Hour of day UTC, 0-23. Default 6 (~12h before planner cron at 18 UTC).';
