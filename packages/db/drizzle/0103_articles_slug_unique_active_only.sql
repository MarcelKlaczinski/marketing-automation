-- Spec 005 IR1 — Status-aware unique index on articles slug.
--
-- Before: hard unique on (project_id, source, collection, locale, slug)
-- treated `superseded` rows as full citizens of the unique key. When a
-- Re-Import re-encountered an OLD-slug after Cleanup-Spec 001 had flipped
-- the matching row to `status='superseded'`, the importer's
-- `onConflictDoUpdate` matched the superseded row and overwrote its
-- filePath in-place — producing Anomaly-A (superseded row with NEW
-- filePath, no active row at that slug).
--
-- After: the unique index is partial — `WHERE status != 'superseded'`.
-- Superseded rows are tombstones, free to coexist with new active rows at
-- the same (project, source, collection, locale, slug). Re-Import's
-- onConflictDoUpdate uses `targetWhere` to mirror this predicate so it
-- only matches active rows.
--
-- Same pattern as `topic_briefs_unique_open_per_gap` (Spec 0032 / 0084).
-- PostgreSQL has no `ALTER INDEX ... SET WHERE`; drop + recreate is the
-- only path.
--
-- Pre-migration verification (run 2026-05-24 against Toolwiki prod):
--   SELECT project_id, source, collection, locale, slug, COUNT(*)
--   FROM articles
--   WHERE status != 'superseded'
--   GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1;
--   → 0 rows. Safe to apply.

DROP INDEX IF EXISTS "articles_project_source_coll_locale_slug_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX "articles_project_source_coll_locale_slug_active_unique"
  ON "articles" ("project_id", "source", "collection", "locale", "slug")
  WHERE "status" != 'superseded';
