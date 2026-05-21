-- Spec 62.3 follow-up: widen the topic_briefs source + cluster_action CHECK constraints
-- to admit the new 'comparison_discovery' source and 'comparison' cluster_action values.
-- Split from 0072 because that migration shipped to local DBs first; this is the additive
-- constraint update.

ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_source_check";
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_source_check" CHECK ("source" IN (
    'gap_analysis',
    'trend_discovery',
    'refresh_detection',
    'manual',
    'comparison_discovery'
  ));

ALTER TABLE "topic_briefs"
  DROP CONSTRAINT IF EXISTS "topic_briefs_cluster_action_check";
ALTER TABLE "topic_briefs"
  ADD CONSTRAINT "topic_briefs_cluster_action_check" CHECK ("cluster_action" IN (
    'append_to_existing',
    'create_new',
    'translation',
    'refresh',
    'standalone',
    'comparison'
  ));
