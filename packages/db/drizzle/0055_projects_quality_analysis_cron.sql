ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "quality_analysis_cron_enabled" boolean NOT NULL DEFAULT false;
