-- Spec 59.1c A.2: Migrate vendor_rss.feeds from string[] to object array.
-- Idempotent: only converts rows where feeds[0] is a string (not already an object).
UPDATE project_configurations
SET signal_sources = jsonb_set(
  signal_sources,
  '{vendor_rss,feeds}',
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'url', feed_url,
        'label', regexp_replace(feed_url, '^https?://(www\.)?', ''),
        'enabled', true,
        'addedAt', NOW()::text,
        'lastVerifiedAt', null
      ))
      FROM jsonb_array_elements_text(signal_sources->'vendor_rss'->'feeds') AS feed_url
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(signal_sources->'vendor_rss'->'feeds') = 'array'
  AND jsonb_array_length(signal_sources->'vendor_rss'->'feeds') > 0
  AND jsonb_typeof(signal_sources->'vendor_rss'->'feeds'->0) = 'string';
