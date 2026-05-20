-- Spec 62.0b: Prompt Versions + Optimization Requests.
-- Closes the two no-op switch-case actions left from 62.0a (promote-golden, extract-for-optimization)
-- by giving each its own table. Designed to be additive-only for future 62.0c (auto-sampling +
-- regression-check + quarantine markers).

-- 1) prompt_versions — promoted prompt overrides ("goldens") per (step, project).
-- The body column stores the systemSuffix replacement only, not the full system prompt
-- (consistent with 62.0a's edit-prompt scope: cacheable foundation stays intact).
CREATE TABLE "prompt_versions" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "step_name"        text NOT NULL,
  "project_id"       uuid NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Content
  "body"             text NOT NULL,
  "source_pause_id"  uuid NULL REFERENCES "step_pauses"("id") ON DELETE SET NULL,

  -- Lifecycle
  "is_golden"        boolean NOT NULL DEFAULT false,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "created_by"       text NULL,
  "superseded_at"    timestamptz NULL,

  -- Audit
  "promote_note"     text NULL
);

-- At most one golden per (step_name, project_id). COALESCE makes NULL project_id (= global)
-- behave as a real comparable value so two globals would conflict too.
CREATE UNIQUE INDEX "prompt_versions_one_golden_per_step"
  ON "prompt_versions" ("step_name", COALESCE("project_id"::text, 'GLOBAL'))
  WHERE "is_golden" = true;

CREATE INDEX "prompt_versions_step_project_idx"
  ON "prompt_versions" ("step_name", "project_id", "created_at" DESC);

-- 2) step_optimization_requests — "this output wasn't good, here's why".
-- Frozen snapshot of the step_pauses row at request time so the source pause can mutate later
-- without invalidating audit. step_pauses is intentionally LEFT unresolved (62.0a-D8 behavior).
CREATE TABLE "step_optimization_requests" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "step_pause_id"   uuid NOT NULL REFERENCES "step_pauses"("id") ON DELETE CASCADE,
  "step_name"       text NOT NULL,
  "pipeline_name"   text NOT NULL,
  "project_id"      uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  -- Frozen snapshot (copied from step_pauses for immutability)
  "step_input"      jsonb NOT NULL,
  "step_output"     jsonb NOT NULL,
  "prompt_used"     text NULL,

  -- User context
  "user_note"       text NOT NULL,
  "requested_at"    timestamptz NOT NULL DEFAULT now(),
  "requested_by"    text NULL,

  -- Lifecycle (future-additive: status can grow; claude-code-response column can be added)
  "status"          text NOT NULL DEFAULT 'open',
  "addressed_at"    timestamptz NULL,
  "addressed_note"  text NULL
);

CREATE INDEX "step_optimization_requests_open_idx"
  ON "step_optimization_requests" ("project_id", "requested_at" DESC)
  WHERE "status" = 'open';

CREATE INDEX "step_optimization_requests_step_idx"
  ON "step_optimization_requests" ("step_name", "project_id", "requested_at" DESC);
