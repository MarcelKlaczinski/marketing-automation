-- Spec 54b: Add content_hash to article_discovery for idempotent LLM backfill.
-- Hash is md5(body_md || frontmatter::text) — recomputed after each LLM enrichment run.
-- Allows skip-logic: if content_hash unchanged since last llm_enriched run, skip.

ALTER TABLE article_discovery
  ADD COLUMN IF NOT EXISTS content_hash text;
