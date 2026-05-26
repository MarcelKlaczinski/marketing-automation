-- Spec 65.5 — recurring-content brief source.
--
-- The 65.5 brief-generator emits one topic_brief per fired
-- recurring_content_definitions row, with `recurring_metadata` jsonb
-- already declared in migration 0114. This migration only widens the
-- topic_briefs.source CHECK so 'recurring' becomes a valid value.
--
-- Mirror to 0109 (star_trend) and 0107 (release_detection) — DROP + ADD
-- because PostgreSQL has no ALTER CONSTRAINT for CHECK predicates.

ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_source_check";
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_source_check" CHECK ("source" IN (
    'gap_analysis',
    'trend_discovery',
    'refresh_detection',
    'manual',
    'comparison_discovery',
    'release_detection',
    'star_trend',
    'recurring'
  ));
