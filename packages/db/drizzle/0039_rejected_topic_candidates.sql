CREATE TABLE "rejected_topic_candidates" (
  "id"                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"                 UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "topic_title"                TEXT NOT NULL,
  "candidate_title_normalized" TEXT NOT NULL,

  "reason"                     TEXT NOT NULL CHECK ("reason" IN (
                                  'existing_coverage', 'low_score',
                                  'excluded_by_scope', 'low_signal_volume'
                                )),
  "trend_score"                INTEGER,
  "similarity_score"           NUMERIC(4, 3),
  "matched_article_id"         UUID,

  "source_signal_ids"          JSONB NOT NULL,

  "rejected_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at"                 TIMESTAMPTZ NOT NULL
);

ALTER TABLE "rejected_topic_candidates"
  ADD CONSTRAINT "rejected_topic_matched_article_fk"
  FOREIGN KEY ("matched_article_id")
  REFERENCES "articles"("id") ON DELETE SET NULL;

CREATE INDEX "rejected_topic_candidates_project_active_idx"
  ON "rejected_topic_candidates" ("project_id", "expires_at");

CREATE INDEX "rejected_topic_candidates_normalized_idx"
  ON "rejected_topic_candidates" ("project_id", "candidate_title_normalized");
