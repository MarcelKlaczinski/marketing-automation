-- Spec 001 (DB-Cleanup Post-Refactor): widen article_status enum with 'superseded'.
--
-- Used by `cleanup-post-refactor-drift` to mark orphan blog rows whose source
-- files were removed by Branch-A (multi-domain-evolution) but which the
-- RepoImportPipeline left behind (no delete-step today).
--
-- 'superseded' is audit-trail rather than DELETE — rows stay filterable via
-- `WHERE status != 'superseded'` and the orphans remain reversible if Marcel
-- restores a removed source file later.
--
-- PostgreSQL requires a new enum value to be committed BEFORE it can be
-- written to a column of that type, so this migration is enum-only. The
-- cleanup script writes `status = 'superseded'` once this has been applied.
-- Same pattern as 0076 (planner_weekly_generation), 0080 (comparison_discovery),
-- 0087 (cost_service google-gemini).

ALTER TYPE "article_status" ADD VALUE IF NOT EXISTS 'superseded';
