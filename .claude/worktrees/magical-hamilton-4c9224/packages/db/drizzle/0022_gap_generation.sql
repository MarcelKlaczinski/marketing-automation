-- Spec 49c: Gap-to-Article Generation
-- Adds tracking columns so a content gap can be linked to the article/spec it spawned.
-- No DB-level FK: avoids dependency ordering issues; UUIDs validated at application layer.

ALTER TABLE content_gaps
  ADD COLUMN filled_by_article_id    UUID,
  ADD COLUMN filled_by_spec_id       UUID,
  ADD COLUMN generation_triggered_at TIMESTAMPTZ;

CREATE INDEX content_gaps_filled_article_idx ON content_gaps(filled_by_article_id)
  WHERE filled_by_article_id IS NOT NULL;

CREATE INDEX content_gaps_filled_spec_idx ON content_gaps(filled_by_spec_id)
  WHERE filled_by_spec_id IS NOT NULL;
