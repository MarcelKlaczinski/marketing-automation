-- Spec 54.12: Full Cluster Generation Schema
-- Non-destructive: existing clusters get generation_status='manual' by default.

-- clusters: new generation-tracking columns
ALTER TABLE "clusters"
  ADD COLUMN "generation_status" text NOT NULL DEFAULT 'manual',
  ADD COLUMN "proposed_spokes" jsonb,
  ADD COLUMN "proposed_hub" jsonb,
  ADD COLUMN "plan_edits" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN "trigger_brief_id" uuid,
  ADD COLUMN "pending_spoke_brief_ids" jsonb DEFAULT '[]'::jsonb;

-- topic_briefs: soft back-link to the cluster created from this brief
ALTER TABLE "topic_briefs"
  ADD COLUMN "routed_cluster_id" uuid;

-- articles: cluster-generation-run tracking (distinct from cluster_id membership)
ALTER TABLE "articles"
  ADD COLUMN "cluster_generation_id" uuid,
  ADD COLUMN "role" text;

-- Index: filter articles by generation run (partial-retry, completion detection)
CREATE INDEX "articles_cluster_generation_id_idx" ON "articles" ("cluster_generation_id");
