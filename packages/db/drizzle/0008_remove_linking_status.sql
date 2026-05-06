-- Audit cleanup: Remove orphaned 'linking' value from article_status enum.
-- 'linking' was added in migration 0007 but no pipeline step ever sets this status.

--> statement-breakpoint
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
