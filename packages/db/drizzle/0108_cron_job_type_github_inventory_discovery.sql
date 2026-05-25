-- Spec 64.20 follow-up A2 — Auto-Discovery cron.
--
-- Same Memory D124 ordering as 0106 / 0080 / 0076 / 0068: enum widening
-- must commit before any `cron_state` row can use the new value. Seed
-- happens in worker startup code (seedGithubInventoryDiscoveryCron),
-- not here.

ALTER TYPE "cron_job_type" ADD VALUE IF NOT EXISTS 'github_inventory_discovery';
