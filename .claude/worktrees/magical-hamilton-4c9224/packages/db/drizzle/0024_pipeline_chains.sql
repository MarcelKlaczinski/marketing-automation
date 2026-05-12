-- Spec 49d: Pipeline Chains (Per-Gap Automation)
-- Tracks multi-step automation chains: Gap → Outline → Draft+Hero → Schema-DE → Localize → Schema-EN → [Astro-Transfer]

CREATE TABLE "pipeline_chains" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"          uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "gap_id"              uuid REFERENCES "content_gaps"("id") ON DELETE SET NULL,
  "article_id"          uuid REFERENCES "articles"("id") ON DELETE CASCADE,
  "sibling_article_id"  uuid REFERENCES "articles"("id") ON DELETE SET NULL,

  "status"              text NOT NULL DEFAULT 'queued',
  "current_step"        text,
  "failed_step"         text,
  "failed_at"           timestamptz,
  "error_message"       text,

  "step_runs"           jsonb NOT NULL DEFAULT '{}',
  "total_cost_eur"      numeric(10, 4) NOT NULL DEFAULT 0,
  "auto_publish"        boolean NOT NULL DEFAULT false,

  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "completed_at"        timestamptz
);

CREATE INDEX "pipeline_chains_project_idx"  ON "pipeline_chains"("project_id");
CREATE INDEX "pipeline_chains_gap_idx"      ON "pipeline_chains"("gap_id");
CREATE INDEX "pipeline_chains_article_idx"  ON "pipeline_chains"("article_id");
CREATE INDEX "pipeline_chains_status_idx"   ON "pipeline_chains"("project_id", "status");

-- Spec 49d: autoPublish flag on projects
-- When true, the automation chain automatically triggers Astro-Transfer after Schema-EN
ALTER TABLE "projects" ADD COLUMN "auto_publish" boolean NOT NULL DEFAULT false;

-- toolwiki is Marcel's flagship — auto-publish enabled by default
UPDATE "projects" SET "auto_publish" = true WHERE "slug" = 'toolwiki';
