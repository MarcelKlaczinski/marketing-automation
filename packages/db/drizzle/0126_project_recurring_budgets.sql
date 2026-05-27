-- Spec 65.V1.5b — Project Recurring Budgets.
--
-- Per-project monthly budget tracker for two cost categories:
--   - 'dry_run'                  → wizard/preview dry-runs (Marcel-initiated)
--   - 'recurring_content_total'  → recurring-content cron-fires (auto-billed)
--
-- Each (project_id, budget_type) row holds the monthly limit + the
-- consumed amount for the *current* month. Month transitions are handled
-- lazily on next access: if `current_month != now-YYYYMM`, the row is
-- reset to `consumed = 0` and `current_month = now-YYYYMM`. A separate
-- monthly-rollover cron may also reset proactively, but is NOT required
-- — the lazy reset keeps the invariant correct without a cron at all.
--
-- Limits stored as integer cents to avoid float drift. €5/month default
-- for dry-run, €15/month default for recurring-content-total.
--
-- Idempotent via `CREATE TABLE IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS project_recurring_budgets (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  budget_type TEXT NOT NULL CHECK (budget_type IN ('dry_run', 'recurring_content_total')),
  monthly_limit_cents INTEGER NOT NULL DEFAULT 500,
  current_month_consumed_cents INTEGER NOT NULL DEFAULT 0,
  current_month INTEGER NOT NULL,  -- YYYYMM, e.g. 202605 for May 2026
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, budget_type)
);

CREATE INDEX IF NOT EXISTS idx_project_recurring_budgets_project
  ON project_recurring_budgets(project_id);
