-- Spec 62.0a-followup Issue 2: rename `batch_checkpoint` → `suspension_checkpoint`.
-- The column was originally added in 0066 to hold batch-API resume data, then reused in
-- 0067 to also hold step-pause resume data via a `kind` discriminator. The new name
-- reflects the union semantics. Data is preserved as-is; only the column name changes.

ALTER TABLE "pipeline_runs" RENAME COLUMN "batch_checkpoint" TO "suspension_checkpoint";
