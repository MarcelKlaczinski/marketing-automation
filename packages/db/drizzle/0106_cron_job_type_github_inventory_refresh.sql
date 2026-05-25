-- Spec 64.20 — extend cron_job_type with github_inventory_refresh.
--
-- PostgreSQL requires a new enum value to be committed BEFORE it can be inserted
-- into a column of that enum type — so the per-project cron_state seed lives in
-- worker startup code (seedGithubInventoryRefreshCron) rather than a SQL seed,
-- same pattern as comparison_discovery (0080) / planner_weekly_generation (0076)
-- / step_pause_cleanup (0068). Memory D124.

ALTER TYPE "cron_job_type" ADD VALUE IF NOT EXISTS 'github_inventory_refresh';
