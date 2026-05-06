-- Spec 21: Astro Markdown Sync Adapter
-- Adds Astro sync tracking to articles, astroRepo config to projects, and astro_sync_runs audit table.

-- articles: Astro sync fields
ALTER TABLE "articles" ADD COLUMN "collection_type" text NOT NULL DEFAULT 'blog';
ALTER TABLE "articles" ADD COLUMN "astro_synced_at" timestamp with time zone;
ALTER TABLE "articles" ADD COLUMN "astro_commit_sha" text;
ALTER TABLE "articles" ADD COLUMN "astro_pull_request_url" text;
ALTER TABLE "articles" ADD COLUMN "astro_asset_paths" jsonb;
ALTER TABLE "articles" ADD COLUMN "astro_frontmatter" jsonb;

-- projects: Astro repo config (null = not wired up)
ALTER TABLE "projects" ADD COLUMN "astro_repo" jsonb;

-- New audit table for sync runs
CREATE TABLE "astro_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"pipeline_run_id" uuid,
	"status" text NOT NULL,
	"commit_sha" text,
	"error_message" text,
	"error_stage" text,
	"files_committed" jsonb,
	"bytes_committed" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);

ALTER TABLE "astro_sync_runs" ADD CONSTRAINT "astro_sync_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "astro_sync_runs_article_idx" ON "astro_sync_runs" ("article_id");
CREATE INDEX "astro_sync_runs_project_status_idx" ON "astro_sync_runs" ("project_id","status");
