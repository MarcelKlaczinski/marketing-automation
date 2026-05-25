-- Spec 65.1 — Placeholder for future per-project persona-config schema.
--
-- Per Marcel-Decision Q5, personas are project-scoped, so no global default-
-- personas table exists today. The DEFAULT_PERSONAS list lives as a TS constant
-- in packages/shared/src/recurring-content/personas.ts and gets seeded into
-- tool_persona_scores via 65.3 per-project backfill at onboarding.
--
-- This migration is intentionally empty. It exists to:
--   1. Preserve the numbering Master-Spec §65.1 promised (0113-0115)
--   2. Reserve a slot if we ever introduce a project_persona_configs table
--      (e.g. if Marcel later wants per-project persona-display-names or
--      ordering overrides without the score row needing to exist).
--
-- Safe to apply (no-op).

SELECT 1;
