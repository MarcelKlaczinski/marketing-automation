-- Spec multi-domain-evolution Branch-B-Sync-Update Point 1 — re-align
-- Toolwiki blog + knowledge category slugs to Branch B's locked English
-- locale-neutral set. The S3.2 seed (0095) used German-slugified values
-- (`guides-und-tutorials`, `vergleiche`, `grundlagen`, etc.) which preserved
-- DE URL routing but diverged from the canonical Toolwiki Astro repo. Branch
-- B's `feature/schema-consolidation` PR locked locale-neutral English slugs
-- as the SoT (`guides-tutorials`, `comparisons`, `fundamentals`, etc.).
--
-- Two-part remap inside a single DO block:
--   1. UPDATE the 10 affected content_categories rows in place: rename `slug`
--      from German to English + update `translations.en.urlSlug` to match the
--      new EN locale-neutral form. `translations.de.*` (label + urlSlug) stays
--      verbatim so existing /de/vergleiche/ URLs continue to resolve via the
--      DE urlSlug — DE-side SEO is preserved.
--   2. UPDATE articles.category remap — any Toolwiki article whose category
--      pointed at one of the 10 old German slugs is rewritten to the new EN
--      slug. The S3.5 consolidation script (--apply) had previously written
--      the German values into ~82 rows; this migration brings them back in
--      line with the Astro renderer.
--
-- Idempotent: re-running finds 0 rows matching the OLD slugs after first run.
-- D124-clean: no enum widening, no type changes, pure DML on existing tables.
-- The composite unique index (project_id, scope, slug) tolerates the rename
-- because the new EN slug doesn't pre-exist for the same (project_id, scope)
-- pair (blog `tool-reviews` is the only EN-from-start slug, untouched here).
--
-- Tool top-level + subcategory slugs (7 + 13) are NOT touched — they were
-- already EN locale-neutral in 0095 and match Branch B's set.
--
-- Translations.<locale>.label values stay as 0095 wrote them. Branch B's
-- authoritative labels live in `<astro-repo>/src/content/categories/*.md`;
-- if the labels diverge from 0095, a future spec writes the override.

DO $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT id INTO v_project_id FROM projects WHERE slug = 'toolwiki' LIMIT 1;
  IF v_project_id IS NULL THEN
    RAISE NOTICE 'Branch-B sync 0099: project slug=toolwiki not found, skipping';
    RETURN;
  END IF;

  ----------------------------------------------------------------------------
  -- 1) Blog slug renames (5 of 6 — `tool-reviews` was already EN-correct)
  ----------------------------------------------------------------------------
  UPDATE content_categories SET
    slug = 'guides-tutorials',
    translations = jsonb_set(translations, '{en,urlSlug}', '"guides-tutorials"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'blog' AND slug = 'guides-und-tutorials';

  UPDATE content_categories SET
    slug = 'comparisons',
    translations = jsonb_set(translations, '{en,urlSlug}', '"comparisons"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'blog' AND slug = 'vergleiche';

  UPDATE content_categories SET
    slug = 'trends-future',
    translations = jsonb_set(translations, '{en,urlSlug}', '"trends-future"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'blog' AND slug = 'trends-und-zukunft';

  UPDATE content_categories SET
    slug = 'practice-use-cases',
    translations = jsonb_set(translations, '{en,urlSlug}', '"practice-use-cases"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'blog' AND slug = 'praxis-und-use-cases';

  UPDATE content_categories SET
    slug = 'ethics-law',
    translations = jsonb_set(translations, '{en,urlSlug}', '"ethics-law"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'blog' AND slug = 'ethik-und-recht';

  ----------------------------------------------------------------------------
  -- 2) Knowledge slug renames (5 of 5)
  -- Note: `ethik-und-recht` also exists under scope='knowledge'; the scope
  -- discriminator in the unique index means the parallel blog rename above
  -- and this knowledge rename do not collide.
  ----------------------------------------------------------------------------
  UPDATE content_categories SET
    slug = 'fundamentals',
    translations = jsonb_set(translations, '{en,urlSlug}', '"fundamentals"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'knowledge' AND slug = 'grundlagen';

  UPDATE content_categories SET
    slug = 'technology',
    translations = jsonb_set(translations, '{en,urlSlug}', '"technology"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'knowledge' AND slug = 'technik';

  UPDATE content_categories SET
    slug = 'ethics-law',
    translations = jsonb_set(translations, '{en,urlSlug}', '"ethics-law"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'knowledge' AND slug = 'ethik-und-recht';

  UPDATE content_categories SET
    slug = 'practice',
    translations = jsonb_set(translations, '{en,urlSlug}', '"practice"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'knowledge' AND slug = 'praxis';

  UPDATE content_categories SET
    slug = 'future',
    translations = jsonb_set(translations, '{en,urlSlug}', '"future"'::jsonb)
  WHERE project_id = v_project_id AND scope = 'knowledge' AND slug = 'zukunft';

  ----------------------------------------------------------------------------
  -- 3) Remap articles.category for any Toolwiki article still pointing at
  --    the old German slug values. CASE matches the rename map above; rows
  --    whose category doesn't match any old value are untouched (WHERE clause
  --    narrows to the 10 known old slugs to keep the EXPLAIN cheap).
  --    Note: articles.category is a plain text column (no FK to
  --    content_categories per S3.4 soft-coupling decision) so no DB-level
  --    constraint to drop/recreate.
  ----------------------------------------------------------------------------
  UPDATE articles SET category = CASE category
    WHEN 'guides-und-tutorials'  THEN 'guides-tutorials'
    WHEN 'vergleiche'            THEN 'comparisons'
    WHEN 'trends-und-zukunft'    THEN 'trends-future'
    WHEN 'praxis-und-use-cases'  THEN 'practice-use-cases'
    WHEN 'ethik-und-recht'       THEN 'ethics-law'
    WHEN 'grundlagen'            THEN 'fundamentals'
    WHEN 'technik'               THEN 'technology'
    WHEN 'praxis'                THEN 'practice'
    WHEN 'zukunft'               THEN 'future'
    ELSE category
  END
  WHERE project_id = v_project_id
    AND category IN (
      'guides-und-tutorials', 'vergleiche', 'trends-und-zukunft',
      'praxis-und-use-cases', 'ethik-und-recht',
      'grundlagen', 'technik', 'praxis', 'zukunft'
    );
END $$;
