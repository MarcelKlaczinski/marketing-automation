-- Spec 64.1: seed `cluster_spoke` goal (min=5, max=10, per_week) for every
-- existing project that doesn't already have one active. New projects pick this
-- up via the Settings UI — no `seedProjectGoals` helper exists today, so this
-- migration is the only mechanism to backfill existing tenants.
--
-- The TS-level CONTENT_TYPES enum (packages/shared/src/types/project-goals.ts)
-- is the validation gate; the DB column is plain text (62.0a Lesson D12), so no
-- CHECK widening is required.

INSERT INTO "project_goals" (
  "project_id",
  "content_type",
  "cadence_unit",
  "min_count",
  "max_count",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  p.id,
  'cluster_spoke',
  'per_week',
  5,
  10,
  true,
  now(),
  now()
FROM "projects" p
WHERE NOT EXISTS (
  SELECT 1
  FROM "project_goals" pg
  WHERE pg.project_id = p.id
    AND pg.content_type = 'cluster_spoke'
    AND pg.is_active = true
);
