-- Spec 41: Cost Enforcement & Pipeline Hardening
-- Pause-state per project (single row per project, UPSERT semantics)
CREATE TABLE project_pause_states (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  paused_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  reason_details jsonb DEFAULT '{}'::jsonb,
  paused_by uuid REFERENCES users(id) ON DELETE SET NULL,
  service text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cost alerts log (alertAtPercent breaches that did not escalate to kill)
CREATE TABLE cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service text NOT NULL,
  threshold_type text NOT NULL CHECK (threshold_type IN ('daily', 'monthly')),
  limit_eur numeric(10,2) NOT NULL,
  spent_eur numeric(10,4) NOT NULL,
  percent integer NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial index for the common unacknowledged-only query path
CREATE INDEX cost_alerts_project_unack_idx
  ON cost_alerts (project_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

-- Full index on project_id for acknowledged/all-alerts queries
CREATE INDEX cost_alerts_project_created_idx
  ON cost_alerts (project_id, created_at DESC);
