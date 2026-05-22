-- =====================================================================
-- Phase 2 — Toolwiki Generated-Articles Cleanup
-- =====================================================================
-- Status:    PREPARED, NOT EXECUTED. Wait for Marcel approval.
-- Discovery: specs/64-quality-reset-discovery.md  (Findings 2026-05-22)
-- Precondition: all Bug-Fix specs deployed (Bug #1 word-drift cap,
--               Bug #2 FAQ, Bug #3 alt-text+schema, Image-Model
--               Nano Banana 2, Hero-Image Outline Rule).
-- Scope:     34 generated blog articles + 1 active draft KW21 plan
--            + 13 briefs (routed_article_id only nulled).
-- Untouched: 272 imported articles, 44 clusters, 174 pending +
--            7 plan_pending + 4 superseded + 2 rejected briefs,
--            all pipeline_runs, all cost_logs, all 60 Astro MDX,
--            19 R2 keys (separate cleanup), project +
--            project_configurations + cron_state + signal_collectors.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1 — Cancel active KW21 draft plan + cascade pending items
-- ---------------------------------------------------------------------
-- NOTE: Production code path is
--   packages/db/src/helpers/weekly-plan-write.ts::transitionWeeklyPlanStatus
-- which preserves invariants and the partial unique index
-- `weekly_plans_one_active_per_week`. The raw UPDATE below mirrors its
-- net effect for verification. If executing via TS, prefer the helper.
UPDATE weekly_plans
   SET status = 'cancelled',
       updated_at = NOW()
 WHERE id = '71f402be-3c17-4c5f-a02b-b9d00ebefd9e';

UPDATE planned_items
   SET status = 'cancelled',
       updated_at = NOW()
 WHERE weekly_plan_id = '71f402be-3c17-4c5f-a02b-b9d00ebefd9e'
   AND status = 'pending';

-- ---------------------------------------------------------------------
-- Step 2 — NULL routed_article_id for 13 briefs (signal-history kept)
-- ---------------------------------------------------------------------
-- approval_status is intentionally NOT flipped — briefs stay in their
-- current state (7 approved + 6 routed). The back-link to the deleted
-- article is severed; signal-history is preserved for future review.
UPDATE topic_briefs
   SET routed_article_id = NULL,
       updated_at = NOW()
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND routed_article_id IN (
     SELECT id FROM articles
      WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
        AND source = 'generated'
        AND collection = 'blog'
   );

-- ---------------------------------------------------------------------
-- Step 3 — DELETE 34 generated blog articles
-- ---------------------------------------------------------------------
-- Cluster FK is nullable / SET NULL — the 5 mixed clusters keep their
-- imported rows and continue to exist.
-- astro_sync_runs.article_id is FK ON DELETE CASCADE on the project
-- (not article); rows for these articles are 0 anyway (Step 10).
-- cost_logs.article_id is nullable — preserved as audit trail.
DELETE FROM articles
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND source = 'generated'
   AND collection = 'blog';

-- =====================================================================
-- VERIFY before COMMIT
-- =====================================================================

-- Expect: 0
SELECT COUNT(*) AS generated_blog_remaining
  FROM articles
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND source = 'generated'
   AND collection = 'blog';

-- Expect: 0
SELECT COUNT(*) AS active_plans
  FROM weekly_plans
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND status IN ('draft','approved','running');

-- Expect: 44 (unchanged)
SELECT COUNT(*) AS clusters_untouched
  FROM clusters
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki');

-- Expect: 272 (unchanged: 108+58+24+24+24+14+10+10)
SELECT COUNT(*) AS imported_articles
  FROM articles
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND source = 'imported';

-- Expect: 7 (unchanged — KW22 seed material)
SELECT COUNT(*) AS plan_pending_briefs
  FROM topic_briefs
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND approval_status = 'plan_pending';

-- Expect: 174 (unchanged)
SELECT COUNT(*) AS pending_briefs_signal_pool
  FROM topic_briefs
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND approval_status = 'pending';

-- Expect: 13 (the briefs that previously routed to deleted articles
-- now have NULL routed_article_id; their approval_status is unchanged)
SELECT COUNT(*) AS detached_briefs
  FROM topic_briefs
 WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
   AND approval_status IN ('approved','routed')
   AND routed_article_id IS NULL
   AND routed_cluster_id IS NULL;

-- =====================================================================
-- DECISION POINT
-- =====================================================================
-- If all verify queries match expected counts: COMMIT;
-- If anything is off:                          ROLLBACK;
-- =====================================================================
