-- Spec 44: Astro repo import — new enum, articles extensions, astroImportRuns table

--> statement-breakpoint
CREATE TYPE "public"."article_source" AS ENUM('generated', 'imported');

--> statement-breakpoint
-- Make cornerstoneKeyword nullable (imported articles have no cornerstone keyword)
ALTER TABLE "articles" ALTER COLUMN "cornerstone_keyword" DROP NOT NULL;

--> statement-breakpoint
-- Drop old (project_id, slug) unique index — replaced by 5-column index below
DROP INDEX IF EXISTS "articles_project_slug_unique";

--> statement-breakpoint
-- New columns on articles
ALTER TABLE "articles" ADD COLUMN "source" "article_source" NOT NULL DEFAULT 'generated';
ALTER TABLE "articles" ADD COLUMN "collection" text NOT NULL DEFAULT 'blog';
ALTER TABLE "articles" ADD COLUMN "locale" text NOT NULL DEFAULT 'de';
ALTER TABLE "articles" ADD COLUMN "translation_key" text;
ALTER TABLE "articles" ADD COLUMN "file_path" text;
ALTER TABLE "articles" ADD COLUMN "git_sha" text;
ALTER TABLE "articles" ADD COLUMN "frontmatter_updated_at" timestamptz;
ALTER TABLE "articles" ADD COLUMN "author" text;
ALTER TABLE "articles" ADD COLUMN "category" text;
ALTER TABLE "articles" ADD COLUMN "subcategory" text;
ALTER TABLE "articles" ADD COLUMN "tags" text[];
ALTER TABLE "articles" ADD COLUMN "noindex" boolean NOT NULL DEFAULT false;
ALTER TABLE "articles" ADD COLUMN "frontmatter_extras" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "articles" ADD COLUMN "import_metadata" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "articles" ADD COLUMN "imported_at" timestamptz;
ALTER TABLE "articles" ADD COLUMN "last_imported_at" timestamptz;

--> statement-breakpoint
-- Backfill existing generated articles with correct collection/locale
UPDATE "articles" SET
  "collection" = COALESCE("collection_type", 'blog'),
  "locale" = 'de'
WHERE "source" = 'generated';

--> statement-breakpoint
-- New unique index: (project_id, source, collection, locale, slug)
CREATE UNIQUE INDEX "articles_project_source_coll_locale_slug_unique"
  ON "public"."articles" ("project_id", "source", "collection", "locale", "slug");

--> statement-breakpoint
-- Supporting indexes
CREATE INDEX "articles_project_translation_key_idx"
  ON "public"."articles" ("project_id", "translation_key");

CREATE INDEX "articles_project_collection_locale_idx"
  ON "public"."articles" ("project_id", "collection", "locale");

CREATE INDEX "articles_project_source_idx"
  ON "public"."articles" ("project_id", "source");

--> statement-breakpoint
-- astro_import_runs table
CREATE TABLE "astro_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "pipeline_run_id" uuid,
  "status" text NOT NULL,
  "trigger_source" text NOT NULL,
  "files_discovered" integer,
  "files_parsed" integer,
  "articles_inserted" integer,
  "articles_updated" integer,
  "articles_unchanged" integer,
  "articles_failed" integer,
  "pairs_linked" integer,
  "orphaned_articles" integer,
  "head_commit_sha" text,
  "error_message" text,
  "error_stage" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);

--> statement-breakpoint
CREATE INDEX "astro_import_runs_project_idx" ON "astro_import_runs" ("project_id");
CREATE INDEX "astro_import_runs_status_idx" ON "astro_import_runs" ("project_id", "status");
