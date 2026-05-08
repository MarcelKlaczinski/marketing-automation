ALTER TABLE "pagespeed_runs"
  ADD COLUMN "mode" text NOT NULL DEFAULT 'local';

CREATE INDEX IF NOT EXISTS "pagespeed_runs_project_mode_idx"
  ON "pagespeed_runs" ("project_id", "mode");
