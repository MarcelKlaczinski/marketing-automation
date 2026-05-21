-- Spec 63.6: brief-approve splits into 'plan' (default) vs 'immediate' dispatch.
-- Default path flips pending → plan_pending (Marcel approved, awaiting Planner pickup).
-- plan_pending → routed transition happens at plan-execute time (when planned_item
-- flips to in_progress), CAS-guarded inside packages/pipelines/src/execution/
-- status-publisher.ts.
--
-- CHECK widening only (Memory D134: own migration, no inline ALTER TABLE with
-- unrelated changes). Drizzle $type union is widened in the same PR.

ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_approval_status_check";
--> statement-breakpoint
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_approval_status_check"
  CHECK ("approval_status" IN (
    'pending', 'plan_pending', 'approved', 'rejected',
    'auto_approved', 'superseded', 'routed'
  ));
--> statement-breakpoint

-- Audit trail: which planned_item kicked off the plan_pending → routed flip.
-- Nullable + ON DELETE SET NULL: deleting a plan should not cascade-orphan briefs,
-- and the column is informational only (Marcel can trace "this brief was routed
-- via plan-item X" in the UI). routed briefs that came through dispatch='immediate'
-- leave this column NULL.
ALTER TABLE "topic_briefs"
  ADD COLUMN "routed_via_plan_item_id" UUID REFERENCES "planned_items"("id") ON DELETE SET NULL;
