CREATE TABLE external_signals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source       TEXT        NOT NULL CHECK (source IN (
                             'producthunt', 'hackernews', 'vendor_rss',
                             'reddit', 'github', 'dataforseo_trends'
                           )),
  external_id  TEXT        NOT NULL,

  title        TEXT        NOT NULL,
  url          TEXT,
  summary      TEXT,
  author       TEXT,
  published_at TIMESTAMPTZ,

  raw_payload  JSONB       NOT NULL,
  metrics      JSONB       NOT NULL DEFAULT '{}'::jsonb,

  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  processed_into UUID,
  expired_at    TIMESTAMPTZ
);

-- FK to topic_briefs declared via raw SQL (avoids circular Drizzle import ordering)
ALTER TABLE external_signals
  ADD CONSTRAINT external_signals_processed_into_fk
  FOREIGN KEY (processed_into) REFERENCES topic_briefs(id) ON DELETE SET NULL;

-- Dedup: same external entity seen twice produces one row
CREATE UNIQUE INDEX external_signals_source_external_unique
  ON external_signals(source, external_id);

CREATE INDEX external_signals_project_source_idx
  ON external_signals(project_id, source);

-- Fast lookup of unprocessed signals per project (used by 54.5 trend scorer)
CREATE INDEX external_signals_unprocessed_idx
  ON external_signals(project_id, collected_at)
  WHERE processed_at IS NULL;

CREATE INDEX external_signals_processed_into_idx
  ON external_signals(processed_into)
  WHERE processed_into IS NOT NULL;
