-- Spec 65.3 — Persona-Scoring + Tool-Data-Refresh foundation.
--
-- TWO orthogonal additions in one migration:
--
-- (A) Per-Marcel Decision §0 + Phase-0 correction: the spec's hypothetical
--     `tools` table doesn't exist — tools live as `articles WHERE
--     collection='tools'`. Tool freshness state lives in a separate jsonb
--     column `tool_data_refresh_metadata` rather than reusing the existing
--     `refresh_metadata` (which is Spec 54.10 article-content-refresh state,
--     a different concern). Pattern 143 — typed jsonb buckets per concern.
--
-- (B) Widen `cron_job_type` enum with `tool_data_refresh` so the cron
--     orchestrator can drive the per-project refresh schedule. Memory D124
--     — enum widening commits BEFORE any code-level seed of cron_state rows,
--     because PostgreSQL forbids using a freshly-added enum value in the
--     same session that added it.
--
-- Staleness scan piggybacks on the existing `articles_last_refreshed_at_idx`
-- partial index (migration 0052) — no new index needed; the staleness
-- predicate is `last_refreshed_at IS NULL OR last_refreshed_at < cutoff` and
-- the existing index covers the non-null branch.

-- (A) Tool-data-refresh metadata column on articles.
ALTER TABLE articles
  ADD COLUMN tool_data_refresh_metadata jsonb;

COMMENT ON COLUMN articles.tool_data_refresh_metadata IS
  'Spec 65.3 — typed bucket for tool-data-refresh state. Shape: ToolDataRefreshMetadata in packages/db/src/schema/content.ts. NULL = tool was never refreshed (lifecycle starts via cron staleness scan).';

-- (B) Cron-orchestrator enum widening.
-- Memory D124 — DO NOT seed cron_state rows in the same migration; the seed
-- happens at worker startup + on project create via `seedToolDataRefreshCron`.
ALTER TYPE cron_job_type ADD VALUE IF NOT EXISTS 'tool_data_refresh';
