-- =====================================================================
-- Phase 2 — Toolwiki Generated-Articles Cleanup
-- =====================================================================
-- Status:    EXECUTED 2026-05-23. All 12 post-conditions matched expected.
-- Discovery: specs/64-quality-reset-discovery.md  (Findings 2026-05-22)
-- Precondition: all Bug-Fix specs deployed (Bug #1 word-drift cap,
--               Bug #2 FAQ, Bug #3 alt-text+schema, Image-Model
--               Nano Banana 2, Hero-Image Outline Rule).
-- Scope:     34 generated blog articles + 1 active draft KW21 plan
--            + 13 routed briefs (HARD DELETE) + 68 pending planned_items
--            (36 from draft plan + 32 stragglers from KW21 superseded).
-- Untouched: 272 imported articles, 44 clusters, 174 pending +
--            7 plan_pending + 6 status-history briefs (4 superseded +
--            2 rejected) + 1 cluster-only routed brief, all 1376
--            pipeline_runs, all 1156 cost_logs, all 60 Astro MDX,
--            18 R2 keys (separate cleanup), project +
--            project_configurations + cron_state + signal_collectors.
-- =====================================================================
-- IMPORTANT DEVIATION FROM ORIGINAL SCRIPT (Memory D20, D21):
-- The original script's Step 1b only cancelled pending items in the
-- KW21 draft plan (1 plan, expected 36 rows). The verify gate at the
-- end ("pending_items = 0 across all plans") encoded the actual intent.
-- During execution, 32 orphan pending items were discovered in a KW21
-- SUPERSEDED plan — a pre-existing data-inconsistency vector (planned-
-- items remained pending while their parent plan was superseded). Per
-- Memory D20 ("Verify-Gate is the spec source of truth"), Step 1b was
-- widened to cancel pending items ACROSS ALL TOOLWIKI PLANS. Total
-- pending-items cancelled: 68 (36 draft + 32 stragglers).
-- Memory D21 documents this orphan-pending pattern as a code-level
-- data-inconsistency to fix at the Plan-Supersede layer.
-- =====================================================================
-- IMPORTANT DEVIATION 2 FROM ORIGINAL SCRIPT (Marcel-Decision 2026-05-23):
-- The original Step 2 NULLed routed_article_id while keeping briefs in
-- their state ("hybrid cleanup"). Marcel's final decision was to HARD
-- DELETE the 13 routed briefs (cleaner state, no limbo with
-- approval_status='routed' but routed_article_id=NULL).
-- The 1 brief with only routed_cluster_id (no article) is preserved.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1a — Cancel active KW21 draft plan
-- ---------------------------------------------------------------------
-- NOTE: Production code path is
--   packages/db/src/helpers/weekly-plan-write.ts::transitionWeeklyPlanStatus
-- which preserves invariants and the partial unique index
-- `weekly_plans_one_active_per_week`. The raw UPDATE below mirrors its
-- net effect for SQL execution. If executing via TS, prefer the helper.
UPDATE weekly_plans
SET status = 'cancelled',
    updated_at = NOW()
WHERE id = '71f402be-3c17-4c5f-a02b-b9d00ebefd9e'
  AND status = 'draft';
-- Expected: 1 row updated

-- ---------------------------------------------------------------------
-- Step 1b — Cancel ALL pending planned_items across ALL toolwiki plans
-- ---------------------------------------------------------------------
-- WIDENED per Memory D20 (Verify-Gate as Source of Truth) +
-- Memory D21 (Orphan Pending Items in Superseded Plans).
-- Original narrow UPDATE only targeted the draft plan (36 items);
-- 32 orphan pending items in KW21 superseded plan also need cancelling
-- to satisfy the verify gate "pending_items = 0 across all plans".
UPDATE planned_items pi
SET status = 'cancelled',
    updated_at = NOW()
  FROM weekly_plans wp
WHERE pi.weekly_plan_id = wp.id
  AND wp.project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND pi.status = 'pending';
-- Expected: 68 rows updated (36 active draft + 32 KW21 superseded stragglers)

-- ---------------------------------------------------------------------
-- Step 2 — HARD DELETE 13 routed briefs (pointing at to-be-deleted articles)
-- ---------------------------------------------------------------------
-- These briefs have routed_article_id pointing at generated articles.
-- Marcel-Decision 2026-05-23: hard-delete is cleaner than NULLing
-- (no limbo state with approval_status='routed' but no target).
-- The 1 routed brief with only routed_cluster_id (no article) is
-- preserved by this WHERE clause.
DELETE FROM topic_briefs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND routed_article_id IN (
  SELECT id FROM articles
  WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
    AND source = 'generated'
    AND collection = 'blog'
);
-- Expected: 13 rows deleted

-- ---------------------------------------------------------------------
-- Step 3 — DELETE 34 generated blog articles
-- ---------------------------------------------------------------------
-- Cluster FK is nullable / ON DELETE SET NULL — the 5 mixed clusters
-- keep their imported rows and continue to exist.
--
-- Cascades (from articles ON DELETE CASCADE):
--   - article_versions: 32 rows
--   - pipeline_chains: 3 rows
--   - article_discovery: 12 rows
--   - template_renders, refresh_dismissed, refresh_suggestions,
--     approvals: 0 rows (confirmed in Phase 0b)
--
-- SET NULL on article-references:
--   - social_posts.article_id (0 rows pointing here)
--   - batch_requests.article_id (preserved audit-trail)
--   - cost_logs.article_id (preserved audit-trail)
--   - astro_sync_runs.article_id (0 rows — never synced)
DELETE FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND source = 'generated'
  AND collection = 'blog';
-- Expected: 34 rows deleted (cascade: 32 article_versions + 3 pipeline_chains + 12 article_discovery)

-- =====================================================================
-- VERIFY before COMMIT — 12 post-conditions
-- =====================================================================

-- Expected: 0
SELECT COUNT(*) AS generated_blog_remaining
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND source = 'generated'
  AND collection = 'blog';

-- Expected: 0
SELECT COUNT(*) AS active_plans
FROM weekly_plans
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND status IN ('draft','approved','running');

-- Expected: 0 (was failing-point in original script — fixed by widened Step 1b)
SELECT COUNT(*) AS pending_items
FROM planned_items pi
       JOIN weekly_plans wp ON pi.weekly_plan_id = wp.id
WHERE wp.project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND pi.status = 'pending';

-- Expected: 9 (1 cancelled today + 8 cancelled/superseded historically)
SELECT COUNT(*) AS plans_history_preserved
FROM weekly_plans
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42';

-- Expected: 44 (unchanged — only article-links severed)
SELECT COUNT(*) AS clusters_untouched
FROM clusters
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42';

-- Expected: 272 (unchanged: 108+58+24+24+24+14+10+10)
SELECT COUNT(*) AS imported_articles
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND source = 'imported';

-- Expected: 174 (signal-pool preserved — €4.77 worth of discovery)
SELECT COUNT(*) AS pending_briefs_signal_pool
FROM topic_briefs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND approval_status = 'pending';

-- Expected: 7 (KW22 seed material preserved)
SELECT COUNT(*) AS plan_pending_briefs
FROM topic_briefs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND approval_status = 'plan_pending';

-- Expected: 6 (4 superseded + 2 rejected — status-history)
SELECT COUNT(*) AS status_history_briefs
FROM topic_briefs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND approval_status IN ('superseded','rejected');

-- Expected: 1 (the routed brief with only routed_cluster_id, no article — preserved)
SELECT COUNT(*) AS routed_brief_cluster_only
FROM topic_briefs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND approval_status = 'routed';

-- Expected: 1376 (full pipeline_runs history preserved)
SELECT COUNT(*) AS pipeline_runs_preserved
FROM pipeline_runs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42';

-- Expected: 1156 (full cost_logs preserved)
SELECT COUNT(*) AS cost_logs_preserved
FROM cost_logs
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42';

-- =====================================================================
-- DECISION POINT
-- =====================================================================
-- If all 12 verify queries match expected counts: COMMIT;
-- If anything is off:                              ROLLBACK;
--
-- Counts to match exactly (executed 2026-05-23 ✅):
--   generated_blog_remaining:   0   ✅
--   active_plans:               0   ✅
--   pending_items:              0   ✅  (was failing-point pre-widening)
--   plans_history_preserved:    9   ✅
--   clusters_untouched:         44  ✅
--   imported_articles:          272 ✅
--   pending_briefs_signal_pool: 174 ✅
--   plan_pending_briefs:        7   ✅
--   status_history_briefs:      6   ✅
--   routed_brief_cluster_only:  1   ✅
--   pipeline_runs_preserved:    1376 ✅
--   cost_logs_preserved:        1156 ✅
-- =====================================================================

COMMIT;

-- =====================================================================
-- POST-CLEANUP STILL PENDING (separate cleanup steps):
-- =====================================================================
-- - 60 Astro MDX files: 0 actually need cleanup (never synced)
-- - 18-19 R2 keys: separate cleanup script (image storage)
-- - Test-Article "ChatGPT Atlas 2026" via generate-standalone:
--   pending after 64.3 + 64.6 + 64.6b deploys
-- =====================================================================
