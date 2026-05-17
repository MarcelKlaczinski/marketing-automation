-- Spec 57.1 Part B: projects.social_auto_render_locales
-- Controls whether the future auto-pipeline renders one or all configured locales.
-- Stored but unused today (manual UI always gives explicit per-trigger choice).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS social_auto_render_locales text NOT NULL DEFAULT 'one';
