ALTER TABLE articles
  ADD COLUMN last_refreshed_at timestamp with time zone;

-- Backfill: use published_at as the initial lastRefreshedAt for existing published articles.
-- Rationale: published articles were "fresh" at publication time; drafts stay NULL.
UPDATE articles
SET last_refreshed_at = published_at
WHERE published_at IS NOT NULL;

CREATE INDEX articles_last_refreshed_at_idx ON articles(last_refreshed_at)
  WHERE last_refreshed_at IS NOT NULL;
