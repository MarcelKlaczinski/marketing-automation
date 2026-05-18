-- Spec 57.3 — Project-scoped template overrides
-- One row per (project, templateKey). Missing row = use schema defaults (no backfill needed).
CREATE TABLE project_template_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_key varchar(64) NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  last_used_at timestamptz,
  CONSTRAINT project_template_overrides_project_template_key UNIQUE (project_id, template_key)
);

CREATE INDEX project_template_overrides_project_id_idx ON project_template_overrides(project_id);
