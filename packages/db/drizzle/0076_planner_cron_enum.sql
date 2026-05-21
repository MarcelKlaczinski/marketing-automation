-- Spec 62.7: extend cron_job_type with planner_weekly_generation.
-- PostgreSQL requires a new enum value to be committed BEFORE it can be inserted
-- into a column of that enum type — so the column additions on
-- project_planner_config + the per-project cron_state seed both live in
-- migration 0077 (canonical pattern from 0068_step_pause_cleanup_enum.sql).

ALTER TYPE "cron_job_type" ADD VALUE IF NOT EXISTS 'planner_weekly_generation';
