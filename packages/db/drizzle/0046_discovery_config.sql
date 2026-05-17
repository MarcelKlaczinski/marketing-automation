-- Spec 56.6: Discovery automation config
-- 4 new columns on projects, cron_state table, refresh_dismissed table

ALTER TABLE projects
  ADD COLUMN trends_cron_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN refresh_cron_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN auto_approve_gaps BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN refresh_staleness_threshold_days INTEGER NOT NULL DEFAULT 90;

-- Enum for cron job types
CREATE TYPE cron_job_type AS ENUM ('trends_synthesizer', 'refresh_detector');

-- Runtime cron state (per-project, per-job-type)
CREATE TABLE cron_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type cron_job_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  cron_pattern TEXT NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_error TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cron_state_project_job_type_unique UNIQUE (project_id, job_type)
);

CREATE INDEX cron_state_active_job_type_idx ON cron_state (is_active, job_type);

-- Sticky dismissals for refresh detection (prevents dismissed articles from re-appearing)
CREATE TABLE refresh_dismissed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_by TEXT NOT NULL DEFAULT 'system',
  reason TEXT,
  CONSTRAINT refresh_dismissed_project_article_unique UNIQUE (project_id, article_id)
);

CREATE INDEX refresh_dismissed_project_idx ON refresh_dismissed (project_id);
CREATE INDEX refresh_dismissed_article_idx ON refresh_dismissed (article_id);

-- Reversible:
-- DROP TABLE refresh_dismissed;
-- DROP TABLE cron_state;
-- DROP TYPE cron_job_type;
-- ALTER TABLE projects
--   DROP COLUMN trends_cron_enabled,
--   DROP COLUMN refresh_cron_enabled,
--   DROP COLUMN auto_approve_gaps,
--   DROP COLUMN refresh_staleness_threshold_days;
