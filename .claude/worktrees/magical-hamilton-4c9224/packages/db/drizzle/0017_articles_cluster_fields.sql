-- Spec 49a: Promote cluster metadata from frontmatter_extras to typed columns

ALTER TABLE "articles"
  ADD COLUMN "cluster_key" text,
  ADD COLUMN "cluster_role" text,
  ADD COLUMN "intent_type" text;

-- Backfill from frontmatter_extras for existing imported articles
UPDATE "articles"
SET
  "cluster_key"  = frontmatter_extras->>'clusterKey',
  "cluster_role" = frontmatter_extras->>'clusterRole',
  "intent_type"  = frontmatter_extras->>'intentType'
WHERE source = 'imported'
  AND frontmatter_extras IS NOT NULL;

CREATE INDEX IF NOT EXISTS "articles_cluster_key_idx"
  ON "articles" ("project_id", "cluster_key");

CREATE INDEX IF NOT EXISTS "articles_cluster_role_idx"
  ON "articles" ("project_id", "cluster_role");
