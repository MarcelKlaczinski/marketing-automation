-- Add FK column to articles linking to the config version active when generated
ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "project_config_version_id" UUID
    REFERENCES "project_configurations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "articles_project_config_version_idx"
  ON "articles"("project_config_version_id")
  WHERE "project_config_version_id" IS NOT NULL;

-- Back-stamp existing articles to their project's active v1 config
UPDATE "articles"
SET "project_config_version_id" = (
  SELECT pc."id"
  FROM "project_configurations" pc
  WHERE pc."project_id" = "articles"."project_id"
    AND pc."status" = 'active'
  LIMIT 1
)
WHERE "project_config_version_id" IS NULL;

-- Add per-pillar intent taxonomy override to content_pillars (nullable)
ALTER TABLE "content_pillars"
  ADD COLUMN IF NOT EXISTS "intent_taxonomy_override" JSONB;
