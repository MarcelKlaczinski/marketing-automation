-- Spec 62.0a Section 4.5.3: extend cron_job_type enum.
-- PostgreSQL requires a new enum value to be committed BEFORE it can be inserted into
-- a column of that enum type — so the seed lives in a separate migration (0069).

ALTER TYPE "cron_job_type" ADD VALUE IF NOT EXISTS 'step_pause_cleanup';
