-- Spec 62.0a: Content-Planner Foundation — Step-Pause + Idempotency-Cache + per-article skip flag.
-- Adds two enum values, two tables, one column on articles.

-- 1) New enum values on pipeline_run_status
--    - 'paused'     = step paused in debug mode awaiting user action (7 actions per spec)
--    - 'superseded' = substep was re-executed by batch-resume / edit-input / edit-prompt;
--                     the original row is closed out cleanly instead of being left orphan-running
ALTER TYPE "pipeline_run_status" ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE "pipeline_run_status" ADD VALUE IF NOT EXISTS 'superseded';

-- 2) step_pauses — one row per pause-resume cycle of a step-run.
CREATE TABLE "step_pauses" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pipeline_run_id"   uuid NOT NULL REFERENCES "pipeline_runs"("id") ON DELETE CASCADE,
  "step_run_id"       uuid NOT NULL REFERENCES "pipeline_runs"("id") ON DELETE CASCADE,
  "step_name"         text NOT NULL,
  "pipeline_name"     text NOT NULL,
  "project_id"        uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Frozen at suspend
  "step_input"        jsonb NOT NULL,
  "step_output"       jsonb NOT NULL,
  "prompt_used"       text NULL,

  -- User decision (one of: approve, edit-output, edit-prompt, edit-input, abort,
  -- promote-golden, extract-for-optimization, auto-dismissed)
  "action"            text NULL,
  "edited_input"      jsonb NULL,
  "edited_output"     jsonb NULL,
  "edited_prompt"     text NULL,
  "user_note"         text NULL,

  -- Lifecycle
  "requested_at"      timestamptz NOT NULL DEFAULT now(),
  "resolved_at"       timestamptz NULL,
  "resolved_by"       text NULL,

  -- A step-run can only have one active pause cycle (resume creates a NEW step-run row).
  CONSTRAINT "step_pauses_step_run_id_unique" UNIQUE ("step_run_id")
);

CREATE INDEX "step_pauses_pipeline_run_id_idx"
  ON "step_pauses" ("pipeline_run_id");

CREATE INDEX "step_pauses_unresolved_idx"
  ON "step_pauses" ("project_id", "requested_at" DESC)
  WHERE "resolved_at" IS NULL;

-- 3) idempotency_outputs — step-level memoization keyed by (pipeline, step, project, idemKey).
-- All inserts MUST use ON CONFLICT DO NOTHING (write race with cache-check is benign).
CREATE TABLE "idempotency_outputs" (
  "idempotency_key"  text NOT NULL,
  "pipeline_name"    text NOT NULL,
  "step_name"        text NOT NULL,
  "project_id"       uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "step_output"      jsonb NOT NULL,
  "cost_eur"         numeric(10, 6) NOT NULL DEFAULT 0,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "expires_at"       timestamptz NULL,
  PRIMARY KEY ("idempotency_key", "pipeline_name", "step_name", "project_id")
);

CREATE INDEX "idempotency_outputs_lookup_idx"
  ON "idempotency_outputs" ("pipeline_name", "step_name", "project_id", "created_at" DESC);

-- 4) articles: per-article auto-translation skip flag (replaces week-level disable).
ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "skip_auto_translation_until" timestamptz NULL;
