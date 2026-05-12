-- Spec 22: PageSpeed Validation
-- Extends article_status enum, adds pagespeed columns to articles and projects,
-- and creates the pagespeed_runs audit table.

--> statement-breakpoint
-- Step 1: Extend article_status enum (choreography required — column has a DEFAULT)
ALTER TABLE "articles" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;
--> statement-breakpoint
DROP TYPE "public"."article_status";
--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM (
  'proposed',
  'approved',
  'generating',
  'outline_review',
  'drafting',
  'final_review',
  'ready_to_publish',
  'validating',
  'published',
  'blocked_by_pagespeed',
  'failed',
  'rejected'
);
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "status" SET DATA TYPE "public"."article_status" USING "status"::"public"."article_status";
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "status" SET DEFAULT 'proposed';
--> statement-breakpoint

-- Step 2: PageSpeed result columns on articles
ALTER TABLE "articles" ADD COLUMN "pagespeed_validated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "pagespeed_scores" jsonb DEFAULT null;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "pagespeed_core_web_vitals" jsonb DEFAULT null;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "pagespeed_failed_thresholds" jsonb DEFAULT null;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "pagespeed_report_url" text;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "pagespeed_astro_commit_sha" text;
--> statement-breakpoint

-- Step 3: PageSpeed thresholds config on projects
ALTER TABLE "projects" ADD COLUMN "pagespeed_thresholds" jsonb NOT NULL DEFAULT '{"performance":85,"accessibility":90,"bestPractices":90,"seo":95}'::jsonb;
--> statement-breakpoint

-- Step 4: pagespeed_runs audit table
CREATE TABLE "pagespeed_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "article_id" uuid NOT NULL,
  "pipeline_run_id" uuid,
  "status" text NOT NULL,
  "outcome" text DEFAULT null,
  "scores" jsonb DEFAULT null,
  "core_web_vitals" jsonb DEFAULT null,
  "thresholds_used" jsonb DEFAULT null,
  "failed_categories" jsonb DEFAULT null,
  "error_message" text,
  "error_stage" text,
  "report_path" text,
  "astro_commit_sha" text,
  "tested_url" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pagespeed_runs" ADD CONSTRAINT "pagespeed_runs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pagespeed_runs_article_idx" ON "pagespeed_runs" ("article_id");
--> statement-breakpoint
CREATE INDEX "pagespeed_runs_project_status_idx" ON "pagespeed_runs" ("project_id","status");
