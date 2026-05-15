CREATE TABLE "topic_briefs" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"          UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Source discriminator
  "source"              TEXT NOT NULL CHECK ("source" IN (
                          'gap_analysis', 'trend_discovery',
                          'refresh_detection', 'manual'
                        )),

  -- Back-reference to originating gap (only when source='gap_analysis')
  "gap_id"              UUID REFERENCES "content_gaps"("id") ON DELETE SET NULL,

  -- Topic identity
  "topic_title"         TEXT NOT NULL,
  "primary_keyword"     TEXT,
  "secondary_keywords"  JSONB NOT NULL DEFAULT '[]'::jsonb,
  "locale"              TEXT,
  "intent_type"         TEXT,

  -- Cluster context
  "cluster_id"          UUID REFERENCES "clusters"("id") ON DELETE SET NULL,
  "cluster_action"      TEXT NOT NULL CHECK ("cluster_action" IN (
                          'append_to_existing', 'create_new',
                          'translation', 'refresh', 'standalone'
                        )),

  -- SEO input
  "search_volume_de"    INTEGER,
  "search_volume_en"    INTEGER,
  "difficulty"          INTEGER,
  "serp_snapshot"       JSONB,

  -- Generation hints
  "suggested_title"     TEXT,
  "suggested_slug"      TEXT,
  "suggested_meta"      TEXT,
  "hero_image_prompt"   TEXT,
  "generation_mode"     TEXT CHECK ("generation_mode" IS NULL OR "generation_mode" IN (
                          'evergreen', 'timely', 'pillar',
                          'spoke', 'refresh', 'translation'
                        )),

  -- Approval & automation
  "approval_required"   BOOLEAN NOT NULL DEFAULT TRUE,
  "approval_status"     TEXT NOT NULL DEFAULT 'pending' CHECK ("approval_status" IN (
                          'pending', 'approved', 'rejected',
                          'auto_approved', 'superseded', 'routed'
                        )),
  "approved_by"         TEXT,
  "approved_at"         TIMESTAMPTZ,

  -- Source-specific metadata (exactly one non-null per row, enforced at application layer)
  "gap_metadata"        JSONB,
  "trend_metadata"      JSONB,
  "refresh_metadata"    JSONB,

  -- Audit
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX "topic_briefs_project_idx"
  ON "topic_briefs"("project_id");
--> statement-breakpoint
CREATE INDEX "topic_briefs_project_status_idx"
  ON "topic_briefs"("project_id", "approval_status");
--> statement-breakpoint
CREATE INDEX "topic_briefs_project_source_idx"
  ON "topic_briefs"("project_id", "source");
--> statement-breakpoint
CREATE INDEX "topic_briefs_gap_id_idx"
  ON "topic_briefs"("gap_id") WHERE "gap_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "topic_briefs_cluster_idx"
  ON "topic_briefs"("cluster_id") WHERE "cluster_id" IS NOT NULL;
--> statement-breakpoint
-- Dedup: one open/routed brief per gap (source='gap_analysis')
CREATE UNIQUE INDEX "topic_briefs_unique_open_per_gap"
  ON "topic_briefs"("gap_id")
  WHERE "gap_id" IS NOT NULL
    AND "approval_status" IN ('pending', 'approved', 'auto_approved', 'routed');
