-- Spec 63.3b: extend cron_job_type with comparison_discovery.
-- PostgreSQL requires a new enum value to be committed BEFORE it can be inserted
-- into a column of that enum type — so the per-project cron_state seed lives in
-- worker startup code (seedComparisonDiscoveryCron) rather than a SQL seed, same
-- pattern as planner_weekly_generation (0076) and step_pause_cleanup (0068).

ALTER TYPE "cron_job_type" ADD VALUE IF NOT EXISTS 'comparison_discovery';
