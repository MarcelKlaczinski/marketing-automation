-- Spec 64.7: Image-Batch Mode for Google Gemini Batch API.
-- Plan-Level Coordinator submits ONE batch per weekly_plan; pipelines
-- suspend at HeroImageStep (kind='image_batch' checkpoint) and resume
-- when the hourly process-results cron picks up completed batches.
--
-- NOTE: cost_service enum 'google-gemini' was added in 0087 (Spec 64.6) —
-- no enum widening needed here.

CREATE TABLE "image_batch_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Plan reference (NULL for legacy/test paths that don't go through a plan).
  -- ON DELETE SET NULL keeps the audit row even if the plan is purged.
  "weekly_plan_id" uuid REFERENCES "weekly_plans"("id") ON DELETE SET NULL,

  -- Plain UUID — no DB FK to avoid circular dep between content.ts ↔ operations.ts
  -- (mirrors batch_requests.pipeline_run_id pattern).
  "pipeline_run_id" uuid,

  -- Google Gemini Batch fields. batch_id is NULL until the plan-coordinator
  -- submits — pending rows wait for a coordinator pass.
  "gemini_batch_id" text,
  -- Stable per-request correlation. Format `img-{pipelineRunId}` so the
  -- resume worker can locate the suspended pipeline_runs row from the
  -- batch result. Pattern 119 separator '_' (Anthropic '^[a-zA-Z0-9_-]{1,64}$').
  "gemini_custom_id" text NOT NULL,

  -- pending | submitted | completed | failed | resume_enqueued
  "status" text NOT NULL DEFAULT 'pending',

  -- Frozen request payload (prompt + model + resolution + aspectRatio + seed).
  -- Adapter rebuilds the Gemini request from this when the coordinator submits.
  "request_body" jsonb NOT NULL,
  -- Filled at process-results time. Shape: { imageUrl, costEur, seed?, error? }
  "response_body" jsonb,

  -- Estimated cost stamped at submit time (image_batch:submit log).
  -- Real cost stamped on resume (image_batch:result log).
  "estimated_cost_eur" numeric(10,4),
  "cost_eur" numeric(10,4),
  "error_message" text,

  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "submitted_at" timestamptz,
  "completed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT "image_batch_requests_status_check"
    CHECK ("status" IN ('pending', 'submitted', 'completed', 'failed', 'resume_enqueued')),
  -- Uniqueness within a submitted batch — prevents accidental double-insertion
  -- of the same pipeline_run into the same Gemini batch. Pre-submit rows
  -- (batch_id NULL) are allowed to share a custom_id, but the coordinator
  -- collapses them to one submit per pipeline_run anyway.
  CONSTRAINT "image_batch_requests_batch_custom_unique"
    UNIQUE ("gemini_batch_id", "gemini_custom_id")
);

-- Hot path for the submit cron: scan pending rows.
CREATE INDEX "idx_image_batch_status_created"
  ON "image_batch_requests" ("status", "created_at")
  WHERE "status" IN ('pending', 'submitted');

-- Resume worker lookup by pipeline_run_id.
CREATE INDEX "idx_image_batch_pipeline_run"
  ON "image_batch_requests" ("pipeline_run_id");

-- Plan-coordinator lookup: "all pending images for this plan".
CREATE INDEX "idx_image_batch_weekly_plan"
  ON "image_batch_requests" ("weekly_plan_id")
  WHERE "weekly_plan_id" IS NOT NULL;

-- Project-scoped queries (admin views).
CREATE INDEX "idx_image_batch_project"
  ON "image_batch_requests" ("project_id");

COMMENT ON TABLE "image_batch_requests" IS
  'Spec 64.7: Per-hero-image batch request rows. One row per pipeline_run hero-image step in batch mode. Plan-coordinator aggregates pending rows per weekly_plan_id into ONE Gemini Batch submit. Status flow: pending → submitted (coordinator) → completed (process-results cron) → resume_enqueued (after pipeline re-enqueued).';

-- weekly_plans.image_batch_id — populated by the plan-coordinator after submit.
-- One batch per approved plan; re-approval doesn't re-submit (status check guards).
ALTER TABLE "weekly_plans"
  ADD COLUMN "image_batch_id" text,
  ADD COLUMN "image_batch_submitted_at" timestamptz,
  ADD COLUMN "image_batch_completed_at" timestamptz;

COMMENT ON COLUMN "weekly_plans"."image_batch_id" IS
  'Spec 64.7: Gemini batch id assigned when the plan-coordinator submits all this plan''s pending image_batch_requests. NULL = no batch submitted yet (sync mode or no hero-image-bearing items).';
