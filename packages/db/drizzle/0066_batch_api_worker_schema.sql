-- Spec 61.4: Anthropic Batch API Worker schema
-- Adds batch_requests table, batch_pending pipeline status,
-- batchCheckpoint on pipeline_runs, and llm_mode on projects.

-- 1. Extend pipeline_run_status enum
ALTER TYPE "pipeline_run_status" ADD VALUE 'batch_pending';

-- 2. Add batch_checkpoint column to pipeline_runs
ALTER TABLE "pipeline_runs"
  ADD COLUMN IF NOT EXISTS "batch_checkpoint" jsonb;

-- 3. Add llm_mode to projects
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "llm_mode" text NOT NULL DEFAULT 'sync';

-- 4. Create batch_requests table
CREATE TABLE "batch_requests" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"          uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "article_id"          uuid REFERENCES "articles"("id") ON DELETE SET NULL,
  "pipeline_run_id"     uuid,

  "anthropic_batch_id"  text,
  "anthropic_custom_id" text NOT NULL,

  "status"              text NOT NULL DEFAULT 'pending',
  "model"               text NOT NULL,
  "step_key"            text NOT NULL,
  "request_body"        jsonb NOT NULL,
  "response_body"       jsonb,
  "error_body"          jsonb,

  "input_tokens"        integer,
  "output_tokens"       integer,
  "cost_eur"            numeric(10, 6),

  "submitted_at"        timestamptz,
  "completed_at"        timestamptz,
  "expires_at"          timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_batch_requests_anthropic_batch_id"
  ON "batch_requests"("anthropic_batch_id");

CREATE INDEX "idx_batch_requests_status"
  ON "batch_requests"("status");

CREATE INDEX "idx_batch_requests_project_id"
  ON "batch_requests"("project_id");
