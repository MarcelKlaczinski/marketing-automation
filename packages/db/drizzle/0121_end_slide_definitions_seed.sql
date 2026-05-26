-- Spec 65.9 — End-Slide Definitions seed for Toolwiki.
--
-- 8 rows / 7 unique types covering all V1 end-slide types referenced by
-- FORMAT_TYPES[*].defaultEndSlides plus the canonical fallback `quote-action`:
--
--   follow-cta          — single brand-follow card
--   comment-to-get      — 2 variants (CLAUDE prompts pack, FAMILY mini-guide)
--   link-in-bio         — "Full comparison at toolwiki.ai" reference card
--   tag-friend          — "Wer braucht das?" community-tag CTA
--   save-share-cta      — "Save for later" engagement nudge
--   swipe-up            — destination card pointing at toolwiki.ai
--   quote-action        — fallback "Stop scrolling. Test it in 30 seconds."
--
-- Each row's `config` is validated against the per-type Zod schema in
-- packages/social/src/end-slide-components/types.ts at pipeline read time.
--
-- Idempotent: a WHERE NOT EXISTS guard on (project_id, type, name) tuple
-- prevents duplicate inserts when the migration re-runs after a partial
-- previous run. Adding new variants later = new rows with distinct `name`,
-- not edits to the existing names.
--
-- Toolwiki project-id resolved via subquery; if the project does not exist
-- (e.g. on a fresh non-Toolwiki tenant) the migration is a no-op.
--
-- Marcel-review checkpoint: edit (name, type, config) tuples below before
-- merge. The dataset is intentionally inline so the entire seed is one diff.

INSERT INTO end_slide_definitions (project_id, name, type, config, is_active)
SELECT
  p.id,
  v.name,
  v.type,
  v.config::jsonb,
  TRUE
FROM projects p
CROSS JOIN (VALUES
  -- ─── follow-cta ────────────────────────────────────────────────────────
  ('Follow for more', 'follow-cta', '{"handle": "@toolwiki.ai"}'),

  -- ─── comment-to-get (2 variants for content-context diversity) ─────────
  ('Comment CLAUDE - prompts', 'comment-to-get',
   '{"keyword": "CLAUDE", "resourceTitle": "Claude Prompts Pack (10 Templates)"}'),
  ('Comment FAMILY - guide', 'comment-to-get',
   '{"keyword": "FAMILY", "resourceTitle": "KI für Familien — Mini-Guide"}'),

  -- ─── link-in-bio ───────────────────────────────────────────────────────
  ('Link in bio - full comparison', 'link-in-bio',
   '{"description": "Vollständiger Vergleich auf toolwiki.ai", "url": "toolwiki.ai"}'),

  -- ─── tag-friend ────────────────────────────────────────────────────────
  ('Tag someone learning AI', 'tag-friend',
   '{"prompt": "Wer braucht das?", "context": "Markiere jemanden der gerade KI entdeckt"}'),

  -- ─── save-share-cta ────────────────────────────────────────────────────
  ('Save for later', 'save-share-cta',
   '{"primaryAction": "save", "message": "Speichern für später"}'),

  -- ─── swipe-up ──────────────────────────────────────────────────────────
  ('Visit toolwiki.ai', 'swipe-up', '{"destination": "toolwiki.ai"}'),

  -- ─── quote-action (V1 fallback when nothing else fits) ─────────────────
  ('Stop scrolling quote', 'quote-action',
   '{"quote": "Stop scrolling. Test it in 30 seconds.", "attribution": "Marcel @ Toolwiki"}')
) AS v(name, type, config)
WHERE p.slug = 'toolwiki'
  AND NOT EXISTS (
    SELECT 1 FROM end_slide_definitions e
    WHERE e.project_id = p.id
      AND e.type = v.type
      AND e.name = v.name
  );
