-- Spec 62.4-followup Issue 1: Sibling-Locale-Removal
--
-- Background: 62.4's ApplySiblingLocaleStep emitted a second planned_item
-- (locale='en', source_kind='sibling_locale', slot_date = parent + 1 day) for
-- every DE cluster item. The first real plan against Toolwiki showed this
-- visually doubled cluster cards in the calendar, and was misleading because
-- the cluster:full-plan + article:blog → article:translation chain already
-- produces DE+EN internally via BlogPipeline.afterComplete / TranslationPipeline.
--
-- Resolution: one planned_item per cluster, locale=null (=> pipeline handles
-- both locales). Add the nullable `locale` column so future single-locale runs
-- can still record 'de' or 'en' explicitly if needed.
--
-- Sibling cleanup: delete sibling_locale rows from draft+approved plans only.
-- running/completed/partially_failed/cancelled/superseded plans keep their
-- existing rows for audit-trail integrity.
--
-- The `sibling_locale` enum-like value in the source_kind CHECK constraint is
-- intentionally retained so historical rows remain valid. New plans will not
-- insert with that value after the code change ships.

-- 1) Add nullable locale column to planned_items.
ALTER TABLE "planned_items"
  ADD COLUMN "locale" text NULL;

-- 2) Drop sibling_locale rows from draft/approved plans (active but not running).
DELETE FROM "planned_items"
WHERE "source_kind" = 'sibling_locale'
  AND "weekly_plan_id" IN (
    SELECT "id" FROM "weekly_plans" WHERE "status" IN ('draft', 'approved')
  );
