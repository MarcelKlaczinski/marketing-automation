-- Spec 65.1 — topic_briefs typed-bucket extension for recurring content.
--
-- Memory §143 typed metadata bucket pattern: NO generic metadata field. Each
-- brief-source owns one strongly-typed jsonb column. `recurring_metadata` joins
-- the existing family (gap_metadata, trend_metadata, refresh_metadata,
-- comparison_metadata, release_metadata, star_trend_metadata) for the recurring
-- content system in Theme 65.
--
-- Note: a 'recurring' value is NOT added to topic_briefs.source / approval_status
-- enums or to the Zod-superRefine in this migration. 65.5 (Brief-Generator) owns
-- the source-enum widening + superRefine extension because that's where the new
-- briefs are actually emitted. Until then `recurring_metadata` exists as a
-- forward-compat column for 65.5 to populate.

ALTER TABLE "topic_briefs"
  ADD COLUMN "recurring_metadata" jsonb;

-- Functional B-tree index on the inner definitionId field — recurring-content
-- consumers in 65.5+ filter "find briefs emitted for THIS definition" hot-path.
-- Partial WHERE excludes legacy rows where the column is NULL (the common case).
CREATE INDEX "idx_topic_briefs_recurring_definition"
  ON "topic_briefs" (("recurring_metadata"->>'definitionId'))
  WHERE "recurring_metadata" IS NOT NULL;
