-- Spec 65.16 — Image-style preset (project default + per-definition override).
--
-- `projects.social_image_style_preset` (NOT NULL, default 'dark-neon-grid')
--   Marcel's project-wide default. Auto-backfills via DEFAULT clause for every
--   existing tenant (Toolwiki → 'dark-neon-grid', per spec §9 Q2 matches the
--   aditya-reference Marcel admires).
--
-- `recurring_content_definitions.social_image_style_preset_override` (nullable)
--   Per-definition override. NULL = inherit project default.
--
-- Content-level override (Spec 65.16 §3.3) is stored in
-- `topic_briefs.recurring_metadata.formatConfig.imageStylePreset` (JSONB,
-- no schema change required since `recurringMetadata` is already typed jsonb).
--
-- CHECK constraint values mirror PRESET_KEYS in `packages/social/src/presets/catalog.ts`.
-- Adding a new preset = (a) widen the const, (b) write a new migration with
-- DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT for both columns. Same pattern as
-- the `cluster_action` widening in migrations 0073 / 0102.

ALTER TABLE "projects"
  ADD COLUMN "social_image_style_preset" text NOT NULL DEFAULT 'dark-neon-grid';

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_social_image_style_preset_check"
  CHECK ("social_image_style_preset" IN ('dark-neon-grid', 'light-editorial', 'blue-tech-gradient'));

ALTER TABLE "recurring_content_definitions"
  ADD COLUMN "social_image_style_preset_override" text;

ALTER TABLE "recurring_content_definitions"
  ADD CONSTRAINT "recurring_content_definitions_social_image_style_preset_override_check"
  CHECK ("social_image_style_preset_override" IS NULL OR "social_image_style_preset_override" IN ('dark-neon-grid', 'light-editorial', 'blue-tech-gradient'));
