-- Spec 62.4: Planner-Engine — weekly_plans + planned_items tables.
--
-- A weekly_plans row is the persisted output of PlanWeekPipeline for one
-- (project, year, iso_week). Re-generation supersedes the prior active row
-- via the partial unique index below. planned_items hold the per-day work
-- units selected by the floor/overage/sibling logic; status='pending'
-- until 62.8 wires execution.
--
-- Foreign keys: project_id (cascade), weekly_plan_id (cascade),
-- source_brief_id (set null on brief delete), source_signal_id (set null on
-- signal delete), parent_item_id (set null on parent delete — sibling DEs
-- remain even if the parent gets cancelled). pipeline_run_id has NO FK
-- (62.0a Lesson D — content.ts → operations.ts circular import via
-- pipeline_runs); we trust the app layer.

-- 1) weekly_plans ─────────────────────────────────────────────────────────
CREATE TABLE "weekly_plans" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"       uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  "year"             integer NOT NULL,
  "iso_week"         integer NOT NULL CHECK ("iso_week" BETWEEN 1 AND 53),
  "week_start_date"  date NOT NULL,
  "week_end_date"    date NOT NULL,

  "status"           text NOT NULL DEFAULT 'draft' CHECK ("status" IN (
                       'draft', 'approved', 'running', 'completed',
                       'partially_failed', 'cancelled', 'superseded'
                     )),
  "triggered_at"     timestamptz NOT NULL DEFAULT now(),
  "approved_at"      timestamptz,
  "approved_by"      text,
  "completed_at"     timestamptz,
  "superseded_at"    timestamptz,
  "superseded_by"    uuid REFERENCES "weekly_plans"("id") ON DELETE SET NULL,

  "estimated_cost_eur" numeric(10, 2) NOT NULL,
  "actual_cost_eur"    numeric(10, 2),

  "input_snapshot"   jsonb NOT NULL,
  "generation_notes" text,

  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

-- Partial unique: at most one active plan per (project, year, week).
-- 'superseded' and 'cancelled' rows can accumulate freely.
CREATE UNIQUE INDEX "weekly_plans_one_active_per_week"
  ON "weekly_plans" ("project_id", "year", "iso_week")
  WHERE "status" NOT IN ('superseded', 'cancelled');

CREATE INDEX "weekly_plans_status_idx"
  ON "weekly_plans" ("project_id", "status", "week_start_date" DESC);

-- 2) planned_items ────────────────────────────────────────────────────────
CREATE TABLE "planned_items" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "weekly_plan_id"    uuid NOT NULL REFERENCES "weekly_plans"("id") ON DELETE CASCADE,
  "project_id"        uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  "content_type"      text NOT NULL,
  "pipeline_name"     text NOT NULL,

  "slot_date"         date NOT NULL,

  "source_kind"       text NOT NULL CHECK ("source_kind" IN (
                        'floor', 'overage_signal', 'sibling_locale'
                      )),
  "source_brief_id"   uuid REFERENCES "topic_briefs"("id") ON DELETE SET NULL,
  "source_signal_id"  uuid REFERENCES "external_signals"("id") ON DELETE SET NULL,
  "parent_item_id"    uuid REFERENCES "planned_items"("id") ON DELETE SET NULL,

  "pipeline_input"    jsonb NOT NULL,

  "estimated_cost_eur" numeric(10, 6) NOT NULL,
  "actual_cost_eur"    numeric(10, 6),

  "selection_score"   numeric(5, 4),
  "selection_reason"  text,

  "status"            text NOT NULL DEFAULT 'pending' CHECK ("status" IN (
                        'pending', 'enqueued', 'in_progress', 'completed',
                        'failed', 'skipped', 'cancelled'
                      )),
  "pipeline_run_id"   uuid,
  "failure_reason"    text,

  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "planned_items_plan_idx"
  ON "planned_items" ("weekly_plan_id", "slot_date", "content_type");

CREATE INDEX "planned_items_status_idx"
  ON "planned_items" ("project_id", "status", "slot_date");

CREATE INDEX "planned_items_pipeline_run_idx"
  ON "planned_items" ("pipeline_run_id")
  WHERE "pipeline_run_id" IS NOT NULL;

-- 3) project_planner_config.excluded_pipelines ────────────────────────────
-- Configurable blacklist of pipeline names the Planner refuses to schedule.
-- Defaults to the pagespeed pipelines (62.0a §6 — long-running browser
-- automation, not appropriate for weekly batched work).
ALTER TABLE "project_planner_config"
  ADD COLUMN "excluded_pipelines" jsonb NOT NULL DEFAULT
    '["article:pagespeed-validation", "article:pagespeed-api-validation"]'::jsonb;
