CREATE TABLE IF NOT EXISTS "project_configurations" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"               UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "version"                  INTEGER NOT NULL,
  "status"                   TEXT NOT NULL DEFAULT 'draft'
                               CHECK ("status" IN ('draft', 'active', 'archived')),

  "intent_taxonomy_default"  JSONB NOT NULL DEFAULT '["comparison","pricing","alternatives","use_case"]'::jsonb,
  "master_prompts"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "topic_scope"              JSONB NOT NULL DEFAULT '{"languages":["de","en"],"exclusions":[]}'::jsonb,
  "signal_sources"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "automation_rules"         JSONB NOT NULL DEFAULT '[]'::jsonb,

  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "activated_at"             TIMESTAMPTZ,
  "archived_at"              TIMESTAMPTZ,

  UNIQUE ("project_id", "version")
);

CREATE INDEX IF NOT EXISTS "project_configurations_project_idx"
  ON "project_configurations"("project_id");

-- Enforces at most one active config per project
CREATE UNIQUE INDEX IF NOT EXISTS "project_configurations_one_active_per_project"
  ON "project_configurations"("project_id")
  WHERE "status" = 'active';

-- Seed v1 active config for every existing project
INSERT INTO "project_configurations" ("project_id", "version", "status", "activated_at")
SELECT "id", 1, 'active', NOW() FROM "projects"
ON CONFLICT DO NOTHING;
