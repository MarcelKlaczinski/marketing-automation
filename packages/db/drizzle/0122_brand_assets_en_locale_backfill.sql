-- Spec 65.V1.5a Bridge #2 — EN-locale brand-assets backfill.
--
-- 65.2 backfilled `tool_brand_assets` for the project's primary locale only
-- (`projects.target_locales[0]`). Toolwiki landed 54 DE rows; the EN siblings
-- have their own `articles.id` row each (per-locale per Memory D8) and need
-- their own `tool_brand_assets` row so renders triggered from EN articles
-- don't fall back to the chain on every paint.
--
-- For each DE `tool_brand_assets` row, INSERT a parallel row keyed on the
-- EN-sibling article (matched by `translation_key` + `project_id`, so the
-- join stays tenant-safe even when two projects happen to share a
-- translation_key string).
--
-- Idempotent via `NOT EXISTS` — re-runs are no-ops once the EN row is in.
-- Doesn't modify existing DE-rows. Adds maximum N new rows where N = number
-- of DE tools that have an EN sibling in `articles` (54 on Toolwiki today).

INSERT INTO tool_brand_assets (
  tool_id, logo_url, logo_dark_url, logo_wordmark_url,
  primary_color, secondary_color, tertiary_color,
  brand_name_canonical, source, needs_review, fetched_at, updated_at
)
SELECT
  en_article.id,
  ba.logo_url, ba.logo_dark_url, ba.logo_wordmark_url,
  ba.primary_color, ba.secondary_color, ba.tertiary_color,
  ba.brand_name_canonical, ba.source, ba.needs_review, ba.fetched_at, NOW()
FROM tool_brand_assets ba
JOIN articles de_article ON de_article.id = ba.tool_id
JOIN articles en_article
  ON en_article.translation_key = de_article.translation_key
  AND en_article.project_id = de_article.project_id
WHERE de_article.locale = 'de'
  AND en_article.locale = 'en'
  AND en_article.collection = 'tools'
  AND NOT EXISTS (
    SELECT 1 FROM tool_brand_assets ba2 WHERE ba2.tool_id = en_article.id
  );
