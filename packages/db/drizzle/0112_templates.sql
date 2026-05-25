-- Spec 65.0 — Template Engine (Pre-Theme-65 Foundation)
--
-- DB-backed registry for Remotion compositions. Source-of-truth is still the
-- filesystem (packages/social/src/templates/definitions/*) — this table tracks
-- discovery metadata, usage stats, and project scoping. Filesystem-watcher
-- (Spec 65.0 Day 3) will UPSERT rows on file-change; for Day 1-2 the
-- existing in-memory `bootstrapTemplates()` call seeds the table at API startup.
--
-- Multi-tenancy note: `project_id` is NULLABLE on purpose (Memory D5
-- multi-tenant exception). NULL = global template available to every tenant.
-- A non-NULL value scopes the row to one project. Same template_key may exist
-- as both global (NULL) AND project-scoped (e.g. Toolwiki override).

-- 1. Templates table.
CREATE TABLE "templates" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"         uuid REFERENCES "projects"("id") ON DELETE CASCADE,
  "template_key"       text NOT NULL,
  "base_template_key"  text NOT NULL,
  "variant"            text,
  "file_path"          text NOT NULL,
  "file_hash"          text NOT NULL,
  "is_active"          boolean NOT NULL DEFAULT TRUE,
  "format_types"       text[] NOT NULL DEFAULT '{}',
  "output_format"      text,
  "compatible_channels" text[] NOT NULL DEFAULT '{}',
  "generation_class"   text,
  "display_name"       text,
  "description"        text,
  "default_slide_count" integer,
  "estimated_cost_usd" numeric(10,4),
  "usage_count"        integer NOT NULL DEFAULT 0,
  "last_used_at"       timestamptz,
  "last_seen_at"       timestamptz NOT NULL DEFAULT NOW(),
  "preview_image_url"  text,
  "created_at"         timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"         timestamptz NOT NULL DEFAULT NOW()
);

-- Unique active key per project (NULL project_id = global).
-- Pre-Spec-005-style partial index: superseded/inactive rows are tombstones,
-- excluded from the uniqueness check so a project can resurrect an old key.
CREATE UNIQUE INDEX "templates_active_key_per_project_uniq"
  ON "templates" ("project_id", "template_key")
  WHERE "is_active" = TRUE;

-- Format-type filtering uses GIN on text[] (planner reads "which templates
-- handle this format_type" — usually 1–5 templates per type).
CREATE INDEX "templates_format_types_gin_idx"
  ON "templates" USING GIN ("format_types");

-- LRU strategy reads `last_used_at NULLS FIRST` so never-used templates
-- bubble up first when 65.6 makes selection decisions.
CREATE INDEX "templates_lru_idx"
  ON "templates" ("last_used_at" NULLS FIRST);

-- Project-scoped lookups (e.g. "all active templates for Toolwiki").
CREATE INDEX "templates_project_active_idx"
  ON "templates" ("project_id", "is_active");

-- Filesystem-watcher reconciliation reads `last_seen_at` to detect templates
-- whose source file has disappeared.
CREATE INDEX "templates_last_seen_idx"
  ON "templates" ("last_seen_at");

-- 2. Articles snapshot — track which template+version rendered an article's
-- social posts (Marcel-Decision §8: "Snapshot bei render, current wins").
-- Both columns are nullable; populated by the render-pipeline when a social
-- post is generated. Existing articles back-fill as NULL and stay NULL until
-- they hit a fresh render.
ALTER TABLE "articles"
  ADD COLUMN "template_key"     text,
  ADD COLUMN "template_version" text;
