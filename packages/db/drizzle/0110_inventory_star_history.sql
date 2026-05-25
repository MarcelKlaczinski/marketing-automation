-- Spec 64.21 — time-series snapshot of star-counts per inventory row.
--
-- The github-inventory-refresh worker writes one row per successful refresh
-- (cadence: refresh_interval_hours per inventory, default 168h = weekly).
-- detectStarTrend() reads the snapshot from N days ago (windowDays default 30)
-- and compares against the current count.
--
-- Pruning: worker calls pruneStarSnapshots(NOW - 90 days) at end of each tick.
-- 90d retention covers 3× the default 30d window — Marcel can widen the
-- detection window without losing historical baselines.

CREATE TABLE IF NOT EXISTS "inventory_star_history" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"    uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "inventory_id"  uuid NOT NULL REFERENCES "content_source_inventory"("id") ON DELETE CASCADE,
  "snapshot_at"   timestamptz NOT NULL DEFAULT NOW(),
  "stars_count"   integer NOT NULL CHECK ("stars_count" >= 0),
  "created_at"    timestamptz NOT NULL DEFAULT NOW()
);

-- Primary read pattern: "what was this inventory row's star count N days ago?"
-- queryStarsAgo() → SELECT ... WHERE inventory_id=$1 AND snapshot_at <= $2
-- ORDER BY snapshot_at DESC LIMIT 1. The DESC tiebreaker is implicit from the
-- index's snapshot_at DESC ordering — same column ordering as the cursor-pagination
-- tiebreaker rule. Project-id is not in the index because inventory_id already
-- uniquely scopes to one tenant (FK chain).
CREATE INDEX IF NOT EXISTS "inventory_star_history_inventory_snapshot_idx"
  ON "inventory_star_history" ("inventory_id", "snapshot_at" DESC);

-- Pruning read pattern: scan all rows older than X across all projects.
CREATE INDEX IF NOT EXISTS "inventory_star_history_snapshot_at_idx"
  ON "inventory_star_history" ("snapshot_at");

-- Multi-tenant safety: any cross-project read should explicitly filter on
-- project_id. The FK alone is structural (CASCADE on project delete), not a
-- query gate — this index is for that filter.
CREATE INDEX IF NOT EXISTS "inventory_star_history_project_idx"
  ON "inventory_star_history" ("project_id");
