-- Spec 65.V1.5b — Auto-Approve + Brief-Skip-Cooldown.
--
-- Three new fields across two tables:
--
-- 1. `projects.recurring_auto_approve_default` (BOOLEAN, default FALSE)
--    Project-level default. When a definition does NOT set an override,
--    this value decides whether the brief auto-approves vs. lands in
--    plan_pending for Marcel-review.
--
-- 2. `recurring_content_definitions.auto_approve_override` (BOOLEAN, NULL)
--    Per-definition override. NULL = inherit project default. TRUE/FALSE =
--    win over project default for this definition only.
--
-- 3. `recurring_content_definitions.last_skip_notified_at` (TIMESTAMPTZ, NULL)
--    Cooldown gate for brief-skip admin notifications. The brief-generator
--    suppresses a skip notification when `NOW() - last_skip_notified_at <
--    24h`. NULL = no prior skip notification (first one always fires).
--
-- Idempotent via `ADD COLUMN IF NOT EXISTS` (each ALTER is its own statement
-- per PostgreSQL syntax).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS recurring_auto_approve_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE recurring_content_definitions
  ADD COLUMN IF NOT EXISTS auto_approve_override BOOLEAN;

ALTER TABLE recurring_content_definitions
  ADD COLUMN IF NOT EXISTS last_skip_notified_at TIMESTAMPTZ;
