-- Spec 65.1 — DB Foundation for Theme 65 (Recurring Content System)
--
-- 7 new tables backing Theme 65's recurring-content workflow:
--   1. recurring_content_definitions — per-project rubrics with cron-frequency
--   2. hook_templates                 — Family-B hook-library
--   3. tool_brand_assets              — logos + colors for carousel rendering
--   4. tool_persona_scores            — LLM-cached persona scoring (project-scoped)
--   5. end_slide_definitions          — pluggable end-slides
--   6. engagement_resources           — PDFs/Resources for comment-to-get DM-funnel
--   7. template_usage_log             — LRU tracking for template-rotation
--
-- Multi-tenancy: every tenant-scoped row carries project_id NOT NULL except
-- tool_brand_assets (tool-scoped because logos are tool-attributes, not
-- project-attributes — same Claude logo serves Toolwiki AND a hypothetical
-- BK project that mentions Claude). tool_persona_scores IS project-scoped per
-- Marcel-Decision Q5 (a "beginners" persona differs across projects).
--
-- FK note: tool_id FKs reference articles(id) (the canonical tool registry —
-- tools live as articles with collection='tools'). Spec narrative referenced
-- a non-existent `tools` table; deviation logged in spec §14.
-- App-layer guard in tool-brand-assets-write.ts + tool-persona-scores-write.ts
-- enforces articles.collection='tools' on insert.

-- ─── 1. recurring_content_definitions ────────────────────────────────────────

CREATE TABLE "recurring_content_definitions" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"                  uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name"                        text NOT NULL,
  "format_type"                 text NOT NULL,
  "format_config"               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "frequency"                   text NOT NULL,
  "next_run_at"                 timestamptz NOT NULL,
  "last_run_at"                 timestamptz,
  "output_targets"              jsonb NOT NULL DEFAULT '{"article":false,"social":true}'::jsonb,
  "template_selection_strategy" text NOT NULL DEFAULT 'lru',
  "fixed_template_key"          text,
  "end_slide_strategy"          text NOT NULL DEFAULT 'rotation',
  "end_slide_pool"              jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active"                   boolean NOT NULL DEFAULT TRUE,
  "created_at"                  timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_recurring_defs_next_run"
  ON "recurring_content_definitions" ("next_run_at")
  WHERE "is_active" = TRUE;
CREATE INDEX "idx_recurring_defs_project"
  ON "recurring_content_definitions" ("project_id");
CREATE INDEX "idx_recurring_defs_format_type"
  ON "recurring_content_definitions" ("format_type")
  WHERE "is_active" = TRUE;

-- ─── 2. hook_templates ───────────────────────────────────────────────────────

CREATE TABLE "hook_templates" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"    uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "format_type"   text NOT NULL,
  "pattern"       text NOT NULL,
  "language"      text NOT NULL,
  "variables"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "usage_count"   integer NOT NULL DEFAULT 0,
  "last_used_at"  timestamptz,
  "is_active"     boolean NOT NULL DEFAULT TRUE,
  "created_at"    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_hook_templates_format_type"
  ON "hook_templates" ("format_type", "language")
  WHERE "is_active" = TRUE;
CREATE INDEX "idx_hook_templates_project"
  ON "hook_templates" ("project_id");
CREATE INDEX "idx_hook_templates_lru"
  ON "hook_templates" ("last_used_at" NULLS FIRST)
  WHERE "is_active" = TRUE;

-- ─── 3. tool_brand_assets ────────────────────────────────────────────────────
--
-- Tool-scoped (no project_id) — Memory D5 multi-tenant exception. Same brand
-- assets serve every project that mentions the tool. PK = tool_id ensures a
-- single canonical row per tool.
-- tool_id references articles(id) where collection='tools' (app-layer enforced).

CREATE TABLE "tool_brand_assets" (
  "tool_id"                uuid PRIMARY KEY REFERENCES "articles"("id") ON DELETE CASCADE,
  "logo_url"               text,
  "logo_dark_url"          text,
  "primary_color"          text,
  "secondary_color"        text,
  "brand_name_canonical"   text,
  "source"                 text NOT NULL,
  "needs_review"           boolean NOT NULL DEFAULT FALSE,
  "fetched_at"             timestamptz NOT NULL,
  "updated_at"             timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_brand_assets_needs_review"
  ON "tool_brand_assets" ("needs_review")
  WHERE "needs_review" = TRUE;
CREATE INDEX "idx_brand_assets_source"
  ON "tool_brand_assets" ("source");

-- ─── 4. tool_persona_scores ──────────────────────────────────────────────────
--
-- Project-scoped per Marcel-Decision Q5. Composite PK (tool_id, project_id,
-- persona) lets each project keep independent scoring for the same tool —
-- e.g. Toolwiki's "beginners" persona ranks differently than a hypothetical
-- BK Solar-Eigentümer persona.
-- tool_id references articles(id) where collection='tools' (app-layer enforced).

CREATE TABLE "tool_persona_scores" (
  "tool_id"     uuid NOT NULL REFERENCES "articles"("id") ON DELETE CASCADE,
  "project_id"  uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "persona"     text NOT NULL,
  "score"       integer NOT NULL CHECK ("score" >= 0 AND "score" <= 10),
  "reasoning"   text NOT NULL,
  "scored_at"   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("tool_id", "project_id", "persona")
);

CREATE INDEX "idx_persona_scores_persona"
  ON "tool_persona_scores" ("project_id", "persona", "score" DESC);

-- Note: spec §3.1 originally included a partial index
--   "idx_persona_scores_stale" WHERE scored_at < NOW() - INTERVAL '6 months'
-- That predicate is INVALID in PostgreSQL — index WHERE clauses must be
-- IMMUTABLE, and NOW() is STABLE not IMMUTABLE. The use-case (find stale
-- scores) is served via deleteStalePersonaScores() helper which builds the
-- cutoff in the application layer and uses the per-tool-id index path.

-- ─── 5. end_slide_definitions ────────────────────────────────────────────────

CREATE TABLE "end_slide_definitions" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"  uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "type"        text NOT NULL,
  "config"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active"   boolean NOT NULL DEFAULT TRUE,
  "created_at"  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_end_slides_project_type"
  ON "end_slide_definitions" ("project_id", "type")
  WHERE "is_active" = TRUE;

-- ─── 6. engagement_resources ─────────────────────────────────────────────────

CREATE TABLE "engagement_resources" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"       uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title"            text NOT NULL,
  "file_url"         text NOT NULL,
  "keyword"          text NOT NULL,
  "resource_type"    text NOT NULL,
  "manychat_flow_id" text,
  "created_at"       timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "uniq_engagement_resources_keyword_per_project"
  ON "engagement_resources" ("project_id", "keyword");
CREATE INDEX "idx_engagement_resources_type"
  ON "engagement_resources" ("project_id", "resource_type");

-- ─── 7. template_usage_log ───────────────────────────────────────────────────
--
-- LRU tracking for template-rotation. Capped at 50 entries per definition by
-- the daily auto-prune cron (apps/api/src/workers/template-usage-log-prune.cron.ts).
-- Inherits project_id transitively via recurring_content_definitions FK.

CREATE TABLE "template_usage_log" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recurring_definition_id"  uuid NOT NULL REFERENCES "recurring_content_definitions"("id") ON DELETE CASCADE,
  "template_key"             text NOT NULL,
  "end_slide_type"           text,
  "used_at"                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_template_usage_def_time"
  ON "template_usage_log" ("recurring_definition_id", "used_at" DESC);
