-- Spec 65.9-followup polish — Toolwiki end-slide EN translations.
--
-- Migration 0124 backfilled `name` + locale-binding config fields with
-- `{de: existing, en: existing}` so the renderer wouldn't crash on EN
-- siblings. The 8 Toolwiki seed rows from migration 0121 therefore have
-- identical DE/EN copy. This migration writes proper EN translations so
-- EN sibling carousels render in correct English from day one without
-- Marcel having to translate every row via the Settings UI.
--
-- Idempotent re-run: each UPDATE guards on `<field>->>'en' = <field>->>'de'`,
-- so a row Marcel already curated stays untouched. Same for `config` fields —
-- the guard reads through the jsonb path and skips when an admin edit lands.
--
-- Locale-agnostic config fields (handle, keyword, url, destination,
-- primaryAction) are not touched — they're the same across locales by design.

-- ─── Row 1: follow-cta "Follow for more" ────────────────────────────────────
UPDATE end_slide_definitions e
SET name = jsonb_build_object(
  'de', 'Folge für mehr',
  'en', 'Follow for more'
)
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'follow-cta'
  AND e.name->>'de' = 'Follow for more'
  AND e.name->>'en' = e.name->>'de';

-- ─── Row 2: comment-to-get CLAUDE prompts ──────────────────────────────────
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Kommentar CLAUDE — Prompts',
    'en', 'Comment CLAUDE — prompts'
  ),
  config = jsonb_set(
    config,
    '{resourceTitle}',
    jsonb_build_object(
      'de', 'Claude-Prompts-Pack (10 Templates)',
      'en', 'Claude Prompts Pack (10 Templates)'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'comment-to-get'
  AND e.config->>'keyword' = 'CLAUDE'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'resourceTitle'->>'en' = e.config->'resourceTitle'->>'de';

-- ─── Row 3: comment-to-get FAMILY guide ────────────────────────────────────
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Kommentar FAMILY — Guide',
    'en', 'Comment FAMILY — guide'
  ),
  config = jsonb_set(
    config,
    '{resourceTitle}',
    jsonb_build_object(
      'de', 'KI für Familien — Mini-Guide',
      'en', 'AI for Families — Mini Guide'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'comment-to-get'
  AND e.config->>'keyword' = 'FAMILY'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'resourceTitle'->>'en' = e.config->'resourceTitle'->>'de';

-- ─── Row 4: link-in-bio Full comparison ────────────────────────────────────
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Link in Bio — Vollständiger Vergleich',
    'en', 'Link in bio — full comparison'
  ),
  config = jsonb_set(
    config,
    '{description}',
    jsonb_build_object(
      'de', 'Vollständiger Vergleich auf toolwiki.ai',
      'en', 'Full comparison at toolwiki.ai'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'link-in-bio'
  AND e.name->>'de' = 'Link in bio - full comparison'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'description'->>'en' = e.config->'description'->>'de';

-- ─── Row 5: tag-friend "Tag someone learning AI" ──────────────────────────
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Tagge jemanden, der KI lernt',
    'en', 'Tag someone learning AI'
  ),
  config = jsonb_set(
    jsonb_set(
      config,
      '{prompt}',
      jsonb_build_object(
        'de', 'Wer braucht das?',
        'en', 'Who needs this?'
      )
    ),
    '{context}',
    jsonb_build_object(
      'de', 'Markiere jemanden, der gerade KI entdeckt',
      'en', 'Tag someone who''s just discovering AI'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'tag-friend'
  AND e.name->>'de' = 'Tag someone learning AI'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'prompt'->>'en' = e.config->'prompt'->>'de'
  AND e.config->'context'->>'en' = e.config->'context'->>'de';

-- ─── Row 6: save-share-cta "Save for later" ───────────────────────────────
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Speichern für später',
    'en', 'Save for later'
  ),
  config = jsonb_set(
    config,
    '{message}',
    jsonb_build_object(
      'de', 'Speichern für später',
      'en', 'Save for later'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'save-share-cta'
  AND e.name->>'de' = 'Save for later'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'message'->>'en' = e.config->'message'->>'de';

-- ─── Row 7: swipe-up "Visit toolwiki.ai" ───────────────────────────────────
UPDATE end_slide_definitions e
SET name = jsonb_build_object(
  'de', 'Besuche toolwiki.ai',
  'en', 'Visit toolwiki.ai'
)
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'swipe-up'
  AND e.name->>'de' = 'Visit toolwiki.ai'
  AND e.name->>'en' = e.name->>'de';

-- ─── Row 8: quote-action "Stop scrolling" ─────────────────────────────────
-- attribution stays "Marcel @ Toolwiki" in both locales (already correct
-- post-0124) — only the quote text needs a DE rendering.
UPDATE end_slide_definitions e
SET
  name = jsonb_build_object(
    'de', 'Anti-Scroll-Zitat',
    'en', 'Stop scrolling quote'
  ),
  config = jsonb_set(
    config,
    '{quote}',
    jsonb_build_object(
      'de', 'Hör auf zu scrollen. Teste es in 30 Sekunden.',
      'en', 'Stop scrolling. Test it in 30 seconds.'
    )
  )
FROM projects p
WHERE e.project_id = p.id
  AND p.slug = 'toolwiki'
  AND e.type = 'quote-action'
  AND e.name->>'de' = 'Stop scrolling quote'
  AND e.name->>'en' = e.name->>'de'
  AND e.config->'quote'->>'en' = e.config->'quote'->>'de';
