-- Migrate hackernews signal_sources from boolean to config object.
-- Existing true  → enabled with broad AI-tool query + minPoints 5
-- Existing false → disabled with same defaults (ready to enable)

UPDATE project_configurations
SET signal_sources = jsonb_set(
  signal_sources,
  '{hackernews}',
  CASE
    WHEN (signal_sources->>'hackernews')::boolean = true
    THEN '{
      "enabled": true,
      "query": "ai OR llm OR gpt OR claude OR gemini OR midjourney OR cursor OR copilot OR sora OR runway OR \"stable diffusion\" OR openai OR anthropic OR huggingface OR \"ai tool\"",
      "hitsPerPage": 50,
      "minPoints": 5
    }'::jsonb
    ELSE '{
      "enabled": false,
      "query": "ai OR llm OR gpt OR claude OR gemini OR midjourney OR cursor OR copilot OR sora OR runway OR \"stable diffusion\" OR openai OR anthropic OR huggingface OR \"ai tool\"",
      "hitsPerPage": 50,
      "minPoints": 5
    }'::jsonb
  END
)
WHERE signal_sources ? 'hackernews'
  AND jsonb_typeof(signal_sources->'hackernews') = 'boolean';
