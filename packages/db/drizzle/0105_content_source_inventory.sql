-- Spec 64.20 — GitHub Tool-Inventory V1: dedicated content_source_inventory table.
--
-- Schema α (per discovery §4) — source-agnostic (gitlab/npm/pypi additions are
-- CHECK widening only), object-type-pluripotent (tool + skill in V1, firmware /
-- monitoring-tool reserved for BK), project-scoped multi-tenant.
--
-- Optional article_id FK enables JOIN from tool-articles (collection='tools') to
-- their inventory row. NULL is legal for skills (no article counterpart) and for
-- tool rows that haven't been linked yet. ON DELETE SET NULL — inventory rows
-- survive article deletion as historical record.
--
-- Partial unique index on (project_id, source, source_identifier) WHERE approved_at
-- IS NOT NULL — V1 rows are pre-approved via Marcel-Seed; V1.1 Auto-Discovery can
-- INSERT additional rows with approved_at NULL without tripping the constraint.
-- Same pattern as articles_project_source_coll_locale_slug_active_unique (Spec
-- 005 IR1) + topic_briefs_unique_open_per_gap (Spec 0032/0084) — Memory D108.

CREATE TABLE "content_source_inventory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Source taxonomy
  "source" text NOT NULL CHECK ("source" IN ('github')),
  "object_type" text NOT NULL CHECK ("object_type" IN ('tool', 'skill')),
  "source_identifier" text NOT NULL,
    -- Tool: "anthropics/claude-code"
    -- Skill (standalone): "coleam00/excalidraw-diagram-skill"
    -- Skill (in mono-repo): "anthropics/skills:web-design"

  -- Human-facing
  "display_name" text NOT NULL,
  "description" text,
  "homepage_url" text,

  -- Structured metadata (typed bucket — D143 pattern, no generic "metadata" name)
  "github_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle
  "fetch_status" text NOT NULL DEFAULT 'pending'
    CHECK ("fetch_status" IN ('pending', 'fetching', 'ok', 'error')),
  "fetch_error" text,
  "last_fetched_at" timestamptz,
  "refresh_interval_hours" integer NOT NULL DEFAULT 168
    CHECK ("refresh_interval_hours" BETWEEN 1 AND 8760),

  -- Approve-gate (V1: pre-approved via Marcel-Seed; V1.1: Auto-Discovery)
  "approved_at" timestamptz,
  "approved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,

  -- Optional link to corresponding tool-article (NULL for skills + new tools).
  -- Application-layer convention: if object_type='tool' AND article_id IS NOT NULL,
  -- THEN articles.collection MUST = 'tools'. Enforced in helper-write + tests.
  "article_id" uuid REFERENCES "articles"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Partial unique on approved rows (D108 — partial unique key for active-only invariants)
CREATE UNIQUE INDEX "csi_project_source_identifier_approved_unique"
  ON "content_source_inventory" ("project_id", "source", "source_identifier")
  WHERE "approved_at" IS NOT NULL;
--> statement-breakpoint

-- Cron candidate index: fetch-due rows ordered NULLS FIRST so first-fetches go before refresh-due
CREATE INDEX "csi_due_for_refresh_idx"
  ON "content_source_inventory" ("last_fetched_at" NULLS FIRST)
  WHERE "approved_at" IS NOT NULL AND "fetch_status" IN ('ok', 'pending');
--> statement-breakpoint

-- Lookup by article (Settings-UI join + future template consumers)
CREATE INDEX "csi_article_id_idx"
  ON "content_source_inventory" ("article_id")
  WHERE "article_id" IS NOT NULL;
--> statement-breakpoint

-- Lookup by project + object-type (Settings-UI list, filtered by status)
CREATE INDEX "csi_project_object_type_idx"
  ON "content_source_inventory" ("project_id", "object_type", "fetch_status");
