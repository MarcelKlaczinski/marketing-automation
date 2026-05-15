-- Migrate hackernews config from single `query` string to `queries` array.
-- Wraps the existing query string in a JSON array; rows that already have
-- `queries` (already migrated or new) are left untouched.
UPDATE project_configurations
SET signal_sources = jsonb_set(
  signal_sources - 'hackernews',
  '{hackernews}',
  jsonb_build_object(
    'enabled',     (signal_sources->'hackernews'->>'enabled')::boolean,
    'queries',     jsonb_build_array(
                     'ai OR llm OR gpt OR claude OR gemini',
                     'midjourney OR "stable diffusion" OR flux OR sora OR runway',
                     'cursor OR copilot OR devin OR codeium',
                     'openai OR anthropic OR huggingface OR replicate'
                   ),
    'hitsPerPage', (signal_sources->'hackernews'->>'hitsPerPage')::int,
    'minPoints',   (signal_sources->'hackernews'->>'minPoints')::int
  )
)
WHERE signal_sources->'hackernews' ? 'query'
  AND NOT (signal_sources->'hackernews' ? 'queries');
