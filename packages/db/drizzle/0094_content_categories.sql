-- Spec multi-domain-evolution S3.1: per-tenant content_categories table.
-- Replaces the three parallel category models Phase-1 found in Toolwiki
-- (blog enum, ki-wissen German enum, tools free-text) with one shape that
-- scales to N domains. Type-only migration; seed data lands in S3.2
-- (separate migration per Memory D124).

CREATE TABLE IF NOT EXISTS "content_categories" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"   uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "slug"         text NOT NULL,
  "scope"        text NOT NULL,
  "parent_slug"  text,
  "translations" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "icon"         text,
  "color"        text,
  "created_at"   timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"   timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_categories_project_scope_slug_idx"
  ON "content_categories" ("project_id", "scope", "slug");

CREATE INDEX IF NOT EXISTS "content_categories_project_scope_idx"
  ON "content_categories" ("project_id", "scope");

CREATE INDEX IF NOT EXISTS "content_categories_parent_slug_idx"
  ON "content_categories" ("project_id", "scope", "parent_slug");

COMMENT ON TABLE "content_categories" IS
  'Spec multi-domain-evolution S3.1: per-tenant category taxonomy. Articles reference categories by slug; soft validation against this table lands in S3.4. The `translations` jsonb is shape `Record<locale, {label, urlSlug}>` and replaces the URL_SLUG_MAP-style maps each tenant Astro repo previously maintained inline.';
