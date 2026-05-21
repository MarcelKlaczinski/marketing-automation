-- Spec 62.3: Signal-Refresh + ComparisonDiscovery.
-- Two foundations consumed by the Planner (Spec 62.4):
--   - refreshSignalsForProject() in packages/planner — on-demand per-source signal refresh
--     gated by project_planner_config.signal_max_age_hours
--   - discoverComparisonPairs() in packages/planner — persists tool-pair candidates as
--     topic_briefs rows with source='comparison_discovery' (matches existing gap/trend/refresh
--     discovery-queue pattern; no new table)
--
-- Schema deviation from spec §3.1: the spec proposed extending article_discovery with
-- discovery_type / payload columns, but article_discovery is the per-article enrichment
-- table (Spec 53c) with UNIQUE(article_id) — it is not a discovery queue. The canonical
-- queue is topic_briefs, which already carries gap_analysis / trend_discovery /
-- refresh_detection / manual sources. Adding comparison_discovery as a fifth source +
-- a comparison_metadata jsonb column fits the established pattern.

-- 1) project_planner_config: per-project staleness threshold for signal refresh.
ALTER TABLE "project_planner_config"
  ADD COLUMN "signal_max_age_hours" integer NOT NULL DEFAULT 24;

-- 2) topic_briefs: comparison-pair metadata column.
-- The accompanying CHECK constraint widening (for source='comparison_discovery' and
-- cluster_action='comparison') ships as migration 0073 — written separately so the
-- existing 0072 row in __drizzle_migrations stays untouched on partially-migrated DBs.
ALTER TABLE "topic_briefs"
  ADD COLUMN "comparison_metadata" jsonb;

-- 3) Partial UNIQUE index for canonicalized (toolASlug < toolBSlug) comparison-pair upsert.
-- Reproduce the full predicate in onConflictDoUpdate targetWhere (root CLAUDE.md gotcha).
CREATE UNIQUE INDEX "topic_briefs_comparison_pair_unique"
  ON "topic_briefs" (
    "project_id",
    ("comparison_metadata"->>'toolASlug'),
    ("comparison_metadata"->>'toolBSlug')
  )
  WHERE "source" = 'comparison_discovery' AND "comparison_metadata" IS NOT NULL;

-- 4) Query index for "find comparison pairs awaiting planning" (62.4 consumer).
CREATE INDEX "topic_briefs_comparison_pairs_idx"
  ON "topic_briefs" ("project_id", "approval_status", "created_at" DESC)
  WHERE "source" = 'comparison_discovery';

-- 5) Defensive index for "max(collected_at) per (project, source)" staleness lookup.
-- The existing external_signals_project_source_idx is on (project_id, source) without
-- collected_at, so the staleness MAX() requires a sort. Adding collected_at DESC lets
-- PostgreSQL return the max via a single index-scan-backwards.
CREATE INDEX "external_signals_recent_per_source_idx"
  ON "external_signals" ("project_id", "source", "collected_at" DESC);
