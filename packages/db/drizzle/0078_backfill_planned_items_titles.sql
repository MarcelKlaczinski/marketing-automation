-- Spec 62-discovery-headlines: backfill pipelineInput.title for existing planned_items.
--
-- Data backfill (not a schema change) — intentionally one-way. Reversal is
-- a trivial `pipeline_input = pipeline_input - 'title'` if ever needed.
--
-- New plans get pipelineInput.title stamped at write time by the
-- SelectFloor / SelectOverage / SelectSocialPost steps. Plans persisted
-- before that change have no title in their pipeline_input JSONB, so the
-- PlannerItemCard falls through to selectionReason ("Floor cluster #1/3")
-- or the raw content-type label.
--
-- Four idempotent UPDATE statements (each guarded by
-- `pipeline_input->>'title' IS NULL` so re-runs are safe):
--   1) Items linked via briefId           → topic_briefs.suggestedTitle ?? topicTitle
--   2) Items linked via parentBriefId     → topic_briefs.suggestedTitle ?? topicTitle  (cluster-derived social posts)
--   3) Items linked via articleId         → articles.title                            (refresh / pool social posts)
--   4) Items with signalTitle (overage)   → pipeline_input->>'signalTitle'            (fallback for older overage rows)

-- 1) Brief-linked items (cluster / comparison / ki_wissen)
UPDATE planned_items pi
SET pipeline_input = pi.pipeline_input || jsonb_build_object(
  'title', COALESCE(tb.suggested_title, tb.topic_title)
)
FROM topic_briefs tb
WHERE (pi.pipeline_input->>'briefId')::uuid = tb.id
  AND pi.pipeline_input->>'title' IS NULL;

-- 2) Parent-brief-linked items (cluster-derived social posts)
UPDATE planned_items pi
SET pipeline_input = pi.pipeline_input || jsonb_build_object(
  'title', COALESCE(tb.suggested_title, tb.topic_title)
)
FROM topic_briefs tb
WHERE (pi.pipeline_input->>'parentBriefId')::uuid = tb.id
  AND pi.pipeline_input->>'title' IS NULL;

-- 3) Article-linked items (refresh / pool social posts).
--    articles.title is nullable — only stamp when set and non-empty so the
--    card cascade can fall back to selectionReason for title-less drafts.
UPDATE planned_items pi
SET pipeline_input = pi.pipeline_input || jsonb_build_object(
  'title', a.title
)
FROM articles a
WHERE (pi.pipeline_input->>'articleId')::uuid = a.id
  AND a.title IS NOT NULL
  AND a.title <> ''
  AND pi.pipeline_input->>'title' IS NULL;

-- 4) Overage signal fallback — items written before the SelectOverageItems
--    step started mirroring signalTitle into `title`. Pure JSONB copy, no
--    join needed.
UPDATE planned_items pi
SET pipeline_input = pi.pipeline_input || jsonb_build_object(
  'title', pi.pipeline_input->>'signalTitle'
)
WHERE pi.pipeline_input ? 'signalTitle'
  AND pi.pipeline_input->>'title' IS NULL;
