-- Spec 20: Article Pipeline schema
-- Replaces article_status enum values, restructures articles table,
-- updates article_versions, extends clusters with cornerstone/satellite keyword columns.

-- 1. Rebuild article_status enum with new lifecycle states
--> statement-breakpoint
-- Drop column default first (it holds a reference to the old enum type)
ALTER TABLE "public"."articles" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "public"."articles" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;
--> statement-breakpoint
DROP TYPE "public"."article_status";
--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM(
  'proposed',
  'approved',
  'generating',
  'outline_review',
  'drafting',
  'final_review',
  'ready_to_publish',
  'published',
  'failed',
  'rejected'
);
--> statement-breakpoint
-- Map any existing rows to the closest new status before converting back
UPDATE "public"."articles" SET "status" =
  CASE "status"
    WHEN 'planned'      THEN 'proposed'
    WHEN 'researching'  THEN 'generating'
    WHEN 'in_review'    THEN 'final_review'
    WHEN 'needs_refresh' THEN 'proposed'
    ELSE "status"
  END
WHERE "status" IN ('planned', 'researching', 'in_review', 'needs_refresh');
--> statement-breakpoint
ALTER TABLE "public"."articles"
  ALTER COLUMN "status" SET DATA TYPE "public"."article_status"
  USING "status"::"public"."article_status";
--> statement-breakpoint
ALTER TABLE "public"."articles" ALTER COLUMN "status" SET DEFAULT 'proposed';

-- 2. Drop old articles columns no longer needed
--> statement-breakpoint
ALTER TABLE "public"."articles"
  DROP COLUMN IF EXISTS "topic",
  DROP COLUMN IF EXISTS "primary_keyword",
  DROP COLUMN IF EXISTS "secondary_keywords",
  DROP COLUMN IF EXISTS "draft_md",
  DROP COLUMN IF EXISTS "metadata",
  DROP COLUMN IF EXISTS "hero_image_url",
  DROP COLUMN IF EXISTS "hero_image_prompt",
  DROP COLUMN IF EXISTS "research_data",
  DROP COLUMN IF EXISTS "generation_log";

-- 3. Add new articles columns
--> statement-breakpoint
ALTER TABLE "public"."articles"
  ADD COLUMN IF NOT EXISTS "cornerstone_spec_id" uuid,
  ADD COLUMN IF NOT EXISTS "cornerstone_keyword" text,
  ADD COLUMN IF NOT EXISTS "outline" jsonb,
  ADD COLUMN IF NOT EXISTS "body_md" text,
  ADD COLUMN IF NOT EXISTS "hero_image_r2_key" text,
  ADD COLUMN IF NOT EXISTS "hero_image_public_url" text,
  ADD COLUMN IF NOT EXISTS "hero_image_alt_text" text,
  ADD COLUMN IF NOT EXISTS "schema_json_ld" jsonb,
  ADD COLUMN IF NOT EXISTS "approval_mode" text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "outline_pipeline_run_id" uuid,
  ADD COLUMN IF NOT EXISTS "draft_pipeline_run_id" uuid,
  ADD COLUMN IF NOT EXISTS "self_review_issues" jsonb,
  ADD COLUMN IF NOT EXISTS "self_review_score" integer,
  ADD COLUMN IF NOT EXISTS "word_count" integer;

-- 4. Make cornerstone_keyword and slug NOT NULL (fill any existing rows first)
--> statement-breakpoint
UPDATE "public"."articles"
  SET "cornerstone_keyword" = COALESCE("slug", "id"::text)
  WHERE "cornerstone_keyword" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."articles" ALTER COLUMN "cornerstone_keyword" SET NOT NULL;
--> statement-breakpoint
UPDATE "public"."articles" SET "slug" = "id"::text WHERE "slug" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."articles" ALTER COLUMN "slug" SET NOT NULL;

-- 5. Replace non-unique slug index with unique index
--> statement-breakpoint
DROP INDEX IF EXISTS "articles_slug_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_project_slug_unique" ON "public"."articles"("project_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_cornerstone_keyword_idx" ON "public"."articles"("cornerstone_keyword");

-- 6. Update article_versions: rename draft_md → body_md, drop metadata
--> statement-breakpoint
ALTER TABLE "public"."article_versions" DROP COLUMN IF EXISTS "metadata";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'article_versions' AND column_name = 'draft_md'
  ) THEN
    ALTER TABLE "public"."article_versions" RENAME COLUMN "draft_md" TO "body_md";
  END IF;
END $$;

-- 7. Add cornerstone/satellite keyword columns to clusters
--> statement-breakpoint
ALTER TABLE "public"."clusters"
  ADD COLUMN IF NOT EXISTS "pillar" text,
  ADD COLUMN IF NOT EXISTS "cornerstone_keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "satellite_keywords" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "public"."clusters" ALTER COLUMN "status" SET DEFAULT 'proposed';
