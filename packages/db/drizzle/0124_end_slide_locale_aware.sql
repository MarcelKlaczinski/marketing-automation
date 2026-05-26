-- Spec 65.9-followup — locale-aware end-slide name + config strings.
--
-- Marcel-bilingual tenants (Toolwiki: de-DE + en-US) curate one End-Slide row
-- and the renderer picks the right locale at render-time. Before this
-- migration `name` was a single text and locale-binding fields in `config`
-- (resourceTitle, description, prompt, message, quote, etc.) were plain
-- strings — so EN sibling carousels rendered with Marcel's DE copy. After:
-- `name` is jsonb `{de, en}` and every locale-binding config field is
-- jsonb `{de, en}` inside the config blob.
--
-- Locale-agnostic config fields stay plain strings:
--   handle, keyword, url, destination, primaryAction
--
-- Data transform: every existing string becomes `{de: <existing>, en: <existing>}`.
-- Marcel curates the EN values via the Settings UI afterwards. The Toolwiki
-- seed (8 rows from migration 0121) gets converted in-place.
--
-- Idempotent re-run safety: each UPDATE guards on
-- `jsonb_typeof(config->'<field>') = 'string'` so a second run skips rows
-- that are already in the jsonb-object shape.

-- ─── 1. `name` column: text → jsonb {de, en} ────────────────────────────────

ALTER TABLE end_slide_definitions
  ALTER COLUMN name TYPE jsonb
  USING jsonb_build_object('de', name, 'en', name);

-- ─── 2. Per-type config field transforms ────────────────────────────────────

-- follow-cta.customMessage (optional)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{customMessage}',
  jsonb_build_object('de', config->>'customMessage', 'en', config->>'customMessage')
)
WHERE type = 'follow-cta'
  AND config ? 'customMessage'
  AND jsonb_typeof(config->'customMessage') = 'string';

-- comment-to-get.resourceTitle (required)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{resourceTitle}',
  jsonb_build_object('de', config->>'resourceTitle', 'en', config->>'resourceTitle')
)
WHERE type = 'comment-to-get'
  AND config ? 'resourceTitle'
  AND jsonb_typeof(config->'resourceTitle') = 'string';

-- comment-to-get.promptText (optional)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{promptText}',
  jsonb_build_object('de', config->>'promptText', 'en', config->>'promptText')
)
WHERE type = 'comment-to-get'
  AND config ? 'promptText'
  AND jsonb_typeof(config->'promptText') = 'string';

-- link-in-bio.description (required)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{description}',
  jsonb_build_object('de', config->>'description', 'en', config->>'description')
)
WHERE type = 'link-in-bio'
  AND config ? 'description'
  AND jsonb_typeof(config->'description') = 'string';

-- tag-friend.prompt (required)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{prompt}',
  jsonb_build_object('de', config->>'prompt', 'en', config->>'prompt')
)
WHERE type = 'tag-friend'
  AND config ? 'prompt'
  AND jsonb_typeof(config->'prompt') = 'string';

-- tag-friend.context (optional)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{context}',
  jsonb_build_object('de', config->>'context', 'en', config->>'context')
)
WHERE type = 'tag-friend'
  AND config ? 'context'
  AND jsonb_typeof(config->'context') = 'string';

-- save-share-cta.message (required)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{message}',
  jsonb_build_object('de', config->>'message', 'en', config->>'message')
)
WHERE type = 'save-share-cta'
  AND config ? 'message'
  AND jsonb_typeof(config->'message') = 'string';

-- swipe-up.customMessage (optional)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{customMessage}',
  jsonb_build_object('de', config->>'customMessage', 'en', config->>'customMessage')
)
WHERE type = 'swipe-up'
  AND config ? 'customMessage'
  AND jsonb_typeof(config->'customMessage') = 'string';

-- quote-action.quote (required)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{quote}',
  jsonb_build_object('de', config->>'quote', 'en', config->>'quote')
)
WHERE type = 'quote-action'
  AND config ? 'quote'
  AND jsonb_typeof(config->'quote') = 'string';

-- quote-action.attribution (optional)
UPDATE end_slide_definitions
SET config = jsonb_set(
  config,
  '{attribution}',
  jsonb_build_object('de', config->>'attribution', 'en', config->>'attribution')
)
WHERE type = 'quote-action'
  AND config ? 'attribution'
  AND jsonb_typeof(config->'attribution') = 'string';
