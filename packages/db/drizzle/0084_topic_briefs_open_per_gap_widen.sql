-- Spec 63.7c — widen "open" set on topic_briefs_unique_open_per_gap
-- to include plan_pending (Spec 63.6 added the status without updating
-- this partial unique index, so gap-detection produced twin briefs while
-- Marcel-approved briefs sat in plan_pending awaiting planner pickup).
--
-- PostgreSQL has no `ALTER INDEX ... SET WHERE`; drop + recreate is the
-- only path. The new "open" set = the existing set plus plan_pending.
-- See packages/db/drizzle/0032_topic_briefs.sql for the original index.

DROP INDEX IF EXISTS "topic_briefs_unique_open_per_gap";
--> statement-breakpoint

CREATE UNIQUE INDEX "topic_briefs_unique_open_per_gap"
  ON "topic_briefs"("gap_id")
  WHERE "gap_id" IS NOT NULL
    AND "approval_status" IN (
      'pending', 'plan_pending', 'approved', 'auto_approved', 'routed'
    );
