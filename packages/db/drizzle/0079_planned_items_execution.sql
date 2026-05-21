-- Spec 62.8: Production-Run Execution columns on planned_items.
--
-- After Phase 0 discovery, we DO NOT add a second 'execution_status' column.
-- The existing `status` column from migration 0074 already models the same
-- lifecycle (pending → enqueued → in_progress → completed | failed | skipped
-- | cancelled). We:
--   1) widen the CHECK to admit a terminal 'published' value (set by
--      Phase E Distribution; 62.8 only writes up to 'completed' / 'failed')
--   2) add execution-tracking timestamp columns + attempts counter + a
--      block_reason field for budget-gate skips
--   3) add two partial indexes that match the worker's read patterns
--
-- Memory D134: CHECK widening must be a DROP + ADD CONSTRAINT pair, not a
-- TS-only union widening. The constraint name follows the inline-CHECK
-- auto-naming convention `<table>_<col>_check` used by 0074.

ALTER TABLE "planned_items"
  DROP CONSTRAINT IF EXISTS "planned_items_status_check";
ALTER TABLE "planned_items"
  ADD CONSTRAINT "planned_items_status_check" CHECK ("status" IN (
    'pending',
    'enqueued',
    'in_progress',
    'completed',
    'failed',
    'skipped',
    'cancelled',
    'published'
  ));

ALTER TABLE "planned_items"
  ADD COLUMN "attempts"                 integer     NOT NULL DEFAULT 0,
  ADD COLUMN "block_reason"             text,
  ADD COLUMN "enqueued_at"              timestamptz,
  ADD COLUMN "generation_started_at"    timestamptz,
  ADD COLUMN "generation_completed_at"  timestamptz;

-- Worker iteration: "give me the next pending item for this plan."
-- Partial-index covers the only read shape the plan-execution worker uses.
CREATE INDEX "planned_items_by_plan_pending_idx"
  ON "planned_items" ("weekly_plan_id", "slot_date")
  WHERE "status" = 'pending';

-- Active-item scan for status UI + plan-status aggregation. Filters to the
-- three "still in flight" states so the index stays small.
CREATE INDEX "planned_items_active_idx"
  ON "planned_items" ("project_id", "status", "slot_date")
  WHERE "status" IN ('pending', 'enqueued', 'in_progress');
