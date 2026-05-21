-- Spec 62.2: Project Goals + Cadence-DSL.
-- Two tables that define what the Content Planner (Spec 62.4) should generate per project
-- per week, without building the Planner itself. The data here is consumed by:
--   - validateProjectGoals() in packages/cost-tracker (library export)
--   - 62.4 Planner Engine (selects items + computes overage)
--   - 62.5 Calendar UI (renders Soll vs Ist)
--   - 62.7 Cron Trigger (planner cadence on/off)

-- 1) project_goals — per-project, per-content-type cadence definitions.
-- content_type is intentionally text (not pgEnum). Rationale: 62.0a Lesson D12 — adding
-- enum values mid-migration is awkward; Zod gates validation at the API layer.
CREATE TABLE "project_goals" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"    uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- What content type this goal applies to:
  -- 'cluster' | 'comparison' | 'social_post' | 'ki_wissen' | (extensible)
  "content_type"  text NOT NULL,

  -- Cadence definition
  "cadence_unit"  text NOT NULL,                      -- 'per_day' | 'per_week'
  "min_count"     integer NOT NULL,                   -- floor (mandatory minimum, may be 0)
  "max_count"     integer NULL,                       -- ceiling for overage (NULL = no per-type cap)

  -- Lifecycle
  "is_active"     boolean NOT NULL DEFAULT true,      -- soft-disable without deleting
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),

  -- Free-text annotation
  "note"          text NULL
);

-- At most one active goal per (project, content_type). Inactive rows may pile up
-- (soft-history); the partial index enforces uniqueness only for the active set.
CREATE UNIQUE INDEX "project_goals_one_active_per_type"
  ON "project_goals" ("project_id", "content_type")
  WHERE "is_active" = true;

CREATE INDEX "project_goals_project_idx"
  ON "project_goals" ("project_id")
  WHERE "is_active" = true;

-- 2) project_planner_config — per-project planner-wide settings (singleton-per-project).
-- Separate table (vs. JSON blob on projects) so 62.4/62.5/62.7 can add columns additively.
CREATE TABLE "project_planner_config" (
  "project_id"                       uuid PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Budget
  "weekly_budget_eur"                numeric(10,2) NOT NULL,
  "per_type_max_eur"                 jsonb NULL,

  -- Overage policy (62.3/62.4 will read these)
  "top_n_signals_allowed_overage"    integer NOT NULL DEFAULT 3,
  "max_overage_per_signal"           integer NOT NULL DEFAULT 1,

  -- Lifecycle
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  "updated_at"                       timestamptz NOT NULL DEFAULT now()
);
