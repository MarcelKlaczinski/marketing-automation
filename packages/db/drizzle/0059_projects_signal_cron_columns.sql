-- Spec 59.1c: Add signal source cron toggle columns to projects table
ALTER TABLE "projects" ADD COLUMN "reddit_signal_cron_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "github_signal_cron_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "hackernews_signal_cron_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "producthunt_signal_cron_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "vendor_rss_signal_cron_enabled" boolean NOT NULL DEFAULT false;
