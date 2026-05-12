-- Spec 49b: Content Gap Detection
-- Stores detected content gaps per cluster/article for manual review before generation

CREATE TABLE content_gaps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_id        UUID REFERENCES clusters(id) ON DELETE CASCADE,

  -- Gap classification
  gap_type          TEXT NOT NULL,  -- 'missing_hub' | 'missing_translation' | 'missing_spoke_type' | 'cluster_too_small'
  locale            TEXT,           -- for missing_translation: the locale that IS missing (e.g. 'en')
  intent_type       TEXT,           -- for missing_spoke_type: which intent is absent
  translation_key   TEXT,           -- for missing_translation: translation_key of the existing article

  -- Prioritisation (1=critical, 2=high, 3=medium)
  priority          INTEGER NOT NULL DEFAULT 2,

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'resolved' | 'dismissed'
  resolved_at       TIMESTAMPTZ,
  dismissed_at      TIMESTAMPTZ,

  -- Context for generation UI
  metadata          JSONB NOT NULL DEFAULT '{}',

  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX content_gaps_project_idx ON content_gaps(project_id);
CREATE INDEX content_gaps_cluster_idx ON content_gaps(cluster_id);
CREATE INDEX content_gaps_status_idx  ON content_gaps(project_id, status);
CREATE INDEX content_gaps_type_idx    ON content_gaps(project_id, gap_type);

-- Dedup: one open gap per (project, cluster, type, locale, intent_type, translation_key)
-- COALESCE to empty string so NULLs don't break the unique index
CREATE UNIQUE INDEX content_gaps_dedup_idx ON content_gaps (
  project_id,
  COALESCE(cluster_id::text, ''),
  gap_type,
  COALESCE(locale, ''),
  COALESCE(intent_type, ''),
  COALESCE(translation_key, '')
) WHERE status IN ('open', 'in_progress');

-- Track when gap detection was last run per project
ALTER TABLE projects
  ADD COLUMN gaps_last_detected_at TIMESTAMPTZ;
