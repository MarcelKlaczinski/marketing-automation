CREATE TYPE "public"."cornerstone_spec_status" AS ENUM (
  'proposed', 'approved', 'in_generation', 'article_done', 'rejected'
);

CREATE TABLE IF NOT EXISTS "cornerstone_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "cluster_id" uuid NOT NULL REFERENCES "clusters"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "translation_key" text NOT NULL,
  "cornerstone_keyword" text NOT NULL,
  "proposed_title" text NOT NULL,
  "proposed_slug" text NOT NULL,
  "meta_description" text NOT NULL,
  "estimated_word_count" integer NOT NULL,
  "h2_outline" jsonb NOT NULL,
  "status" "cornerstone_spec_status" NOT NULL DEFAULT 'proposed',
  "rejected_reason" text,
  "article_id" uuid,
  "cornerstone_list_pipeline_run_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "cornerstone_specs_cluster_locale_unique"
  ON "cornerstone_specs" ("cluster_id", "locale");
CREATE INDEX "cornerstone_specs_translation_key_idx"
  ON "cornerstone_specs" ("project_id", "translation_key");
CREATE INDEX "cornerstone_specs_project_status_idx"
  ON "cornerstone_specs" ("project_id", "status");
CREATE INDEX "cornerstone_specs_cluster_id_idx"
  ON "cornerstone_specs" ("cluster_id");

CREATE INDEX IF NOT EXISTS "articles_cornerstone_spec_id_idx"
  ON "articles" ("cornerstone_spec_id");
