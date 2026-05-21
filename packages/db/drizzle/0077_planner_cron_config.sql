-- Spec 62.7: per-project cron-trigger config on project_planner_config.
--
-- Auto-triggers PlanWeekPipeline once per week at the configured day-of-week
-- + hour-UTC. Default OFF — Marcel toggles in SettingsPlannerPage.
--
-- Per-project cron_state rows for 'planner_weekly_generation' are NOT seeded
-- here. They are seeded at worker startup via seedPlannerWeeklyGenerationCron()
-- (canonical pattern from 0069_step_pause_cleanup_seed.sql), and on project
-- create in routes/projects.ts. PostgreSQL forbids using a new enum value in
-- the session that added it, so 0076 + 0077 cannot do the INSERT itself.

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "cron_enabled"     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cron_day_of_week" integer NOT NULL DEFAULT 0
    CHECK ("cron_day_of_week" BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS "cron_hour_utc"    integer NOT NULL DEFAULT 18
    CHECK ("cron_hour_utc" BETWEEN 0 AND 23);

COMMENT ON COLUMN "project_planner_config"."cron_day_of_week"
  IS '0=Sunday, 1=Monday, ..., 6=Saturday. Default 0 (Sunday).';
COMMENT ON COLUMN "project_planner_config"."cron_hour_utc"
  IS 'Hour of day UTC, 0-23. Default 18 (= 19:00 CET / 20:00 CEST).';
