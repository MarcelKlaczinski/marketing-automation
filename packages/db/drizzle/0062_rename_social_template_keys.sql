-- Update social_posts.template_key
UPDATE social_posts SET template_key = 'comparison-grid-4'
  WHERE template_key = 'comparison-stunning';

UPDATE social_posts SET template_key = 'comparison-grid-3'
  WHERE template_key = 'comparison-stunning-3';

UPDATE social_posts SET template_key = 'verdict-per-use-case'
  WHERE template_key = 'use-case-verdict-per-tool';

-- Update project_template_overrides.template_key
UPDATE project_template_overrides SET template_key = 'comparison-grid-4'
  WHERE template_key = 'comparison-stunning';

UPDATE project_template_overrides SET template_key = 'comparison-grid-3'
  WHERE template_key = 'comparison-stunning-3';

UPDATE project_template_overrides SET template_key = 'verdict-per-use-case'
  WHERE template_key = 'use-case-verdict-per-tool';

-- Patch JSONB renderInput.templateKey where present (Spec 58.2 snapshot pattern)
UPDATE social_posts
SET content = jsonb_set(
  content,
  '{renderInput,templateKey}',
  CASE content->'renderInput'->>'templateKey'
    WHEN 'comparison-stunning' THEN '"comparison-grid-4"'::jsonb
    WHEN 'comparison-stunning-3' THEN '"comparison-grid-3"'::jsonb
    WHEN 'use-case-verdict-per-tool' THEN '"verdict-per-use-case"'::jsonb
    ELSE content->'renderInput'->'templateKey'
  END
)
WHERE content ? 'renderInput'
  AND content->'renderInput' ? 'templateKey'
  AND content->'renderInput'->>'templateKey' IN (
    'comparison-stunning', 'comparison-stunning-3', 'use-case-verdict-per-tool'
  );
