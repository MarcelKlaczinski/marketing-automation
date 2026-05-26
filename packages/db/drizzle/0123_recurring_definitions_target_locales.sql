-- Spec 65.V1.5a Bridge #3 — multi-locale fan-out for recurring_content_definitions.
--
-- Before this migration, the recurring-brief worker derived language from
-- `projects.target_locales[0]` (BCP-47 → first 2 chars), producing exactly one
-- brief per fire. Bridge #3 lets Marcel toggle EN-output independently per
-- definition (Toolwiki is bilingual but not every rubric needs an EN twin).
--
-- New column `target_locales` (jsonb array of 2-letter codes, default `["de"]`).
-- Existing rows inherit the default — they keep producing DE-only briefs
-- exactly like before. The cron-worker reads this column on each fire and
-- loops once per locale, sharing a `runGroupId` UUID across siblings for
-- downstream sibling-linking (frozen into `recurring_metadata.runGroupId`).
--
-- Idempotent via `IF NOT EXISTS` so re-runs are no-ops.

ALTER TABLE recurring_content_definitions
  ADD COLUMN IF NOT EXISTS target_locales jsonb NOT NULL DEFAULT '["de"]'::jsonb;
