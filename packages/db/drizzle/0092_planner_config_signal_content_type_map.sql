-- Spec 64.14 Phase A: per-project override for signal-source → content_type
-- mapping in SelectOverageItemsStep. NULL = use DEFAULT_SIGNAL_CONTENT_TYPE_MAP.
-- jsonb shape: { [source: string]: PlanningContentType | null }. A null value
-- on a known source means "skip overage emission for this source".

ALTER TABLE "project_planner_config"
  ADD COLUMN IF NOT EXISTS "signal_source_content_type_map" jsonb;

COMMENT ON COLUMN "project_planner_config"."signal_source_content_type_map" IS
  'Spec 64.14: per-project override for inferContentTypeFromSignal mapping. NULL = use DEFAULT_SIGNAL_CONTENT_TYPE_MAP (hackernews/github default to null per Spec 64.14 Phase A). JSON shape: { [source: string]: PlanningContentType | null }.';
