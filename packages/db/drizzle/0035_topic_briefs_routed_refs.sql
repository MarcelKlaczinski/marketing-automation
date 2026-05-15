-- Spec 54.3: TopicRoutingPolicy — add direct article/spec links to topic_briefs
-- When executeDecision routes a brief, it writes the created row ID back here atomically.
ALTER TABLE topic_briefs
  ADD COLUMN routed_article_id UUID
    REFERENCES articles(id) ON DELETE SET NULL,
  ADD COLUMN routed_cornerstone_spec_id UUID
    REFERENCES cornerstone_specs(id) ON DELETE SET NULL;

CREATE INDEX topic_briefs_routed_article_idx
  ON topic_briefs(routed_article_id)
  WHERE routed_article_id IS NOT NULL;

CREATE INDEX topic_briefs_routed_cornerstone_idx
  ON topic_briefs(routed_cornerstone_spec_id)
  WHERE routed_cornerstone_spec_id IS NOT NULL;
