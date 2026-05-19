-- Spec 59.1c: Add three new signal-collector cron job type enum values
ALTER TYPE "cron_job_type" ADD VALUE 'signal_collector_hackernews';
ALTER TYPE "cron_job_type" ADD VALUE 'signal_collector_producthunt';
ALTER TYPE "cron_job_type" ADD VALUE 'signal_collector_vendor_rss';
