-- Spec 64.20 follow-up A3 — Release-Detection brief source.
--
-- The GitHub-inventory refresh worker compares each row's prior
-- `github_metadata.latestRelease.tag` against the freshly-fetched tag.
-- When they differ AND a prior tag existed (= not first-fetch baseline),
-- the worker enqueues a news-style topic_brief with source='release_detection'
-- and a populated release_metadata bucket.
--
-- Pacing: max 5 briefs/week per project (top by stars). Excess silently
-- dropped — no row in rejected_topic_candidates for V1.

-- 1. Widen topic_briefs.source CHECK to admit the new value.
ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_source_check";
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_source_check" CHECK ("source" IN (
    'gap_analysis',
    'trend_discovery',
    'refresh_detection',
    'manual',
    'comparison_discovery',
    'release_detection'
  ));

-- 2. New typed-bucket jsonb column for release-detection metadata.
ALTER TABLE "topic_briefs"
  ADD COLUMN "release_metadata" jsonb;
