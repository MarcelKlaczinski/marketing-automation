CREATE TYPE refresh_suggestion_source AS ENUM ('time', 'quality');

CREATE TABLE refresh_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source refresh_suggestion_source NOT NULL,
  reasoning text,
  staleness_days int,
  quality_findings jsonb,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  dismissed_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_run_id uuid,
  CONSTRAINT refresh_suggestions_article_source UNIQUE (article_id, source)
);

CREATE INDEX refresh_suggestions_active_idx ON refresh_suggestions(article_id)
  WHERE dismissed_at IS NULL AND approved_at IS NULL;

CREATE INDEX refresh_suggestions_article_idx ON refresh_suggestions(article_id);
CREATE INDEX refresh_suggestions_project_idx ON refresh_suggestions(project_id);
