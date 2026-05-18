-- Spec E.1a: Add 'quality_analysis' to cron_job_type enum for auto quality analysis cron toggle
ALTER TYPE cron_job_type ADD VALUE IF NOT EXISTS 'quality_analysis';
