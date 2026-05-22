-- Spec 64.15 Phase C: precomputed Voyage embedding for topic_briefs.
--
-- Before: SelectFloorItemsStep / Spec 63.5 diversity provider computed
-- embeddings on-the-fly per plan-run, ~€0.001 per brief × N runs/week. Plus
-- a latency hit at plan-generation time.
--
-- After: emit-brief.ts (trend-discovery) computes the embedding once at brief
-- creation time. The plan-runner reads it precomputed; legacy briefs (manual,
-- comparison_discovery, gap_analysis) without an embedding get a lazy backfill
-- on first read via the existing diversity provider (per ensureEmbedding in
-- the Phase C wiring).
--
-- Schema:
--   - `embedding vector(1024)` — Voyage-3 dim. NULLABLE because:
--       1. Pre-spec briefs exist (~180 in Toolwiki at migration time).
--       2. Non-trend-discovery brief-creation sites bypass emit-brief.ts and
--          rely on lazy-backfill (manual creation via POST /briefs, gap-detection
--          auto-suggest, comparison-discovery persistPairs).
--   - HNSW cosine index — mirrors clusters.embedding (Spec 24) for symmetry +
--     enables future "find similar briefs" UI without a follow-up migration.

ALTER TABLE topic_briefs
  ADD COLUMN embedding vector(1024);

CREATE INDEX topic_briefs_embedding_hnsw_idx
  ON topic_briefs
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON COLUMN topic_briefs.embedding IS
  'Precomputed Voyage-3 embedding (Spec 64.15 Phase C). NULL for pre-spec briefs and for non-trend-discovery creation sites that rely on lazy backfill via ensureEmbedding.';
