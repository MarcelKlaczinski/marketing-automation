-- Spec 64.6: extend cost_service enum with 'google-gemini' for the new
-- nano-banana (Gemini Image API) adapter.
--
-- PostgreSQL requires a new enum value to be committed BEFORE it can be
-- inserted into a column of that enum type — so this migration is enum-only.
-- The adapter writes cost_logs.service = 'google-gemini' once the migration
-- has been applied. Same pattern as 0080 (comparison_discovery) and 0076
-- (planner_weekly_generation).

ALTER TYPE "cost_service" ADD VALUE IF NOT EXISTS 'google-gemini';
