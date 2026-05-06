-- Spec 24: Internal Linking Pipeline
-- Adds 'linking' status, internal link tracking columns, budget column, and link_rebuild_runs table.

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
  'schema_extending',
  'linking',
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

-- Step 2: Add internal linking columns to articles
ALTER TABLE "articles" ADD COLUMN "internal_links_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "internal_links_added" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "internal_link_targets" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Step 3: Add link_rebuild_budget_monthly to projects
ALTER TABLE "projects" ADD COLUMN "link_rebuild_budget_monthly" numeric(10, 2) DEFAULT '30.00';
--> statement-breakpoint

-- Step 4: link_rebuild_runs audit table
CREATE TABLE "link_rebuild_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "cluster_id" uuid,
  "pipeline_run_id" uuid,
  "status" text NOT NULL,
  "trigger_type" text NOT NULL,
  "articles_processed" integer DEFAULT 0,
  "articles_modified" integer DEFAULT 0,
  "total_links_added" integer DEFAULT 0,
  "total_cost_eur" numeric(10, 4) DEFAULT '0',
  "error_message" text,
  "error_stage" text,
  "triggering_article_id" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "link_rebuild_runs" ADD CONSTRAINT "link_rebuild_runs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "link_rebuild_runs_cluster_idx" ON "link_rebuild_runs" ("cluster_id");
--> statement-breakpoint
CREATE INDEX "link_rebuild_runs_project_status_idx" ON "link_rebuild_runs" ("project_id", "status");
