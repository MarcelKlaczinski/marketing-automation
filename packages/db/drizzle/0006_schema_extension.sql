-- Spec 23: Schema.org Extensions
-- Adds schema_extending status, converts schemaJsonLd to array, adds schema_extension_runs table.

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

-- Step 2: Convert schemaJsonLd from single object to array
-- Wrap existing non-null objects in a single-element array; leave nulls as null.
UPDATE "articles"
SET "schema_json_ld" = jsonb_build_array("schema_json_ld")
WHERE "schema_json_ld" IS NOT NULL
  AND jsonb_typeof("schema_json_ld") = 'object';
--> statement-breakpoint

-- Step 3: schema_extension_runs audit table
CREATE TABLE "schema_extension_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "article_id" uuid NOT NULL,
  "pipeline_run_id" uuid,
  "status" text NOT NULL,
  "detected_types" jsonb DEFAULT null,
  "faq_question_count" integer DEFAULT 0,
  "howto_step_count" integer DEFAULT 0,
  "error_message" text,
  "error_stage" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "schema_extension_runs" ADD CONSTRAINT "schema_extension_runs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "schema_extension_runs_article_idx" ON "schema_extension_runs" ("article_id");
--> statement-breakpoint
CREATE INDEX "schema_extension_runs_project_status_idx" ON "schema_extension_runs" ("project_id", "status");
