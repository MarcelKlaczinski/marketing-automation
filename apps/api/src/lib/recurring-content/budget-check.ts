/**
 * Spec 65.V1.5b — Recurring-content budget tracker.
 *
 * Per-project monthly cost-cap for two budget categories:
 *   - `dry_run` — wizard/preview dry-runs (pre-flight gate before LLM call).
 *   - `recurring_content_total` — auto-billed cron-fires (gate + record).
 *
 * Two operations:
 *   - `checkBudgetAvailable({projectId, budgetType, expectedCostCents})`
 *     pre-flight check. Returns `{allowed, consumed, limit, currentMonth}`.
 *     Caller decides to proceed (allowed=true) or 429 (allowed=false).
 *   - `recordBudgetConsumption({projectId, budgetType, actualCostCents})`
 *     post-flight. Atomic UPDATE with `consumed = consumed + actual`.
 *
 * Lazy month-rollover: both operations check `current_month` against
 * `now-YYYYMM`. If they differ, the row resets (`consumed = 0`,
 * `current_month = now-YYYYMM`). This keeps the invariant correct
 * without requiring a separate cron; a monthly cron may also reset
 * proactively but is purely an optimisation.
 *
 * Defaults applied on first access: €5/month dry-run, €15/month
 * recurring-content-total. Marcel can adjust via the Settings UI.
 */

import { and, db, eq, projectRecurringBudgets, sql } from "@marketing-auto/db";
import type { RecurringBudgetType } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("recurring-content:budget-check");

export const DEFAULT_LIMIT_CENTS: Record<RecurringBudgetType, number> = {
  dry_run: 500, // €5/month — covers ~16-25 dry-runs at €0.20-0.30/run
  recurring_content_total: 1500, // €15/month — covers ~50-75 real renders
};

/**
 * Returns YYYYMM (e.g. 202605 for May 2026). Pure, deterministic, no DB.
 */
export function currentYearMonth(now: Date = new Date()): number {
  return now.getUTCFullYear() * 100 + (now.getUTCMonth() + 1);
}

export interface CheckBudgetInput {
  projectId: string;
  budgetType: RecurringBudgetType;
  expectedCostCents: number;
}

export interface BudgetState {
  allowed: boolean;
  consumed: number;
  limit: number;
  currentMonth: number;
}

/**
 * Pre-flight gate. Returns whether the projected consumption fits inside
 * the monthly budget. Idempotent — calling this without `recordBudgetConsumption`
 * does NOT mutate the row.
 *
 * Performs lazy month-rollover: if the stored `current_month` is older than
 * the calling-time month, resets `consumed = 0` and updates `current_month`
 * in the same TX. The reset is itself idempotent (same SQL twice = same
 * result).
 */
export async function checkBudgetAvailable(input: CheckBudgetInput): Promise<BudgetState> {
  const yyyymm = currentYearMonth();
  const row = await loadOrCreateBudget(input.projectId, input.budgetType, yyyymm);

  // Lazy rollover — if the row's month is older, reset before the check.
  const effectiveConsumed = row.currentMonth === yyyymm ? row.currentMonthConsumedCents : 0;
  if (row.currentMonth !== yyyymm) {
    await db
      .update(projectRecurringBudgets)
      .set({
        currentMonthConsumedCents: 0,
        currentMonth: yyyymm,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectRecurringBudgets.projectId, input.projectId),
          eq(projectRecurringBudgets.budgetType, input.budgetType),
        ),
      );
  }

  const projected = effectiveConsumed + input.expectedCostCents;
  const allowed = projected <= row.monthlyLimitCents;

  return {
    allowed,
    consumed: effectiveConsumed,
    limit: row.monthlyLimitCents,
    currentMonth: yyyymm,
  };
}

export interface RecordBudgetInput {
  projectId: string;
  budgetType: RecurringBudgetType;
  actualCostCents: number;
}

/**
 * Post-flight recorder. Atomic UPDATE with `consumed = consumed + actual`.
 * Also performs lazy rollover if needed — the SET clause does the reset
 * inline so two concurrent recorders never race against a stale `current_month`.
 */
export async function recordBudgetConsumption(input: RecordBudgetInput): Promise<void> {
  const yyyymm = currentYearMonth();
  // Ensure the row exists so the UPDATE has a target.
  await loadOrCreateBudget(input.projectId, input.budgetType, yyyymm);

  // Atomic: if current_month matches, add to consumed; else reset + add.
  await db
    .update(projectRecurringBudgets)
    .set({
      currentMonthConsumedCents: sql`CASE
        WHEN ${projectRecurringBudgets.currentMonth} = ${yyyymm}
        THEN ${projectRecurringBudgets.currentMonthConsumedCents} + ${input.actualCostCents}
        ELSE ${input.actualCostCents}
      END`,
      currentMonth: yyyymm,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectRecurringBudgets.projectId, input.projectId),
        eq(projectRecurringBudgets.budgetType, input.budgetType),
      ),
    );
}

/**
 * Load the (project, budgetType) row; create with defaults if missing.
 * Returns the row AFTER any insert. Pure idempotency via `ON CONFLICT`.
 */
async function loadOrCreateBudget(
  projectId: string,
  budgetType: RecurringBudgetType,
  yyyymm: number,
) {
  const existing = await db
    .select()
    .from(projectRecurringBudgets)
    .where(
      and(
        eq(projectRecurringBudgets.projectId, projectId),
        eq(projectRecurringBudgets.budgetType, budgetType),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  await db
    .insert(projectRecurringBudgets)
    .values({
      projectId,
      budgetType,
      monthlyLimitCents: DEFAULT_LIMIT_CENTS[budgetType],
      currentMonthConsumedCents: 0,
      currentMonth: yyyymm,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(projectRecurringBudgets)
    .where(
      and(
        eq(projectRecurringBudgets.projectId, projectId),
        eq(projectRecurringBudgets.budgetType, budgetType),
      ),
    )
    .limit(1);

  if (!row) {
    // Should not happen — INSERT ... ON CONFLICT DO NOTHING followed by a
    // SELECT must find the row in any concurrent-write outcome.
    log.error({ projectId, budgetType }, "budget row vanished after upsert");
    throw new Error(`budget-row-vanished: ${projectId}/${budgetType}`);
  }
  return row;
}

export interface UpdateBudgetLimitInput {
  projectId: string;
  budgetType: RecurringBudgetType;
  monthlyLimitCents: number;
}

/**
 * Settings-UI hook: change the monthly limit for a (project, budget) pair.
 * Does NOT reset `consumed` — that stays correct for the current month.
 */
export async function updateBudgetLimit(input: UpdateBudgetLimitInput): Promise<BudgetState> {
  if (input.monthlyLimitCents < 0) {
    throw new Error("monthlyLimitCents must be non-negative");
  }
  const yyyymm = currentYearMonth();
  await loadOrCreateBudget(input.projectId, input.budgetType, yyyymm);

  await db
    .update(projectRecurringBudgets)
    .set({
      monthlyLimitCents: input.monthlyLimitCents,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectRecurringBudgets.projectId, input.projectId),
        eq(projectRecurringBudgets.budgetType, input.budgetType),
      ),
    );

  const updated = await checkBudgetAvailable({
    projectId: input.projectId,
    budgetType: input.budgetType,
    expectedCostCents: 0,
  });
  return updated;
}

/**
 * Read-only fetch for the Settings UI. Returns both budgets in one query.
 * Auto-creates missing rows with default limits.
 */
export async function listProjectBudgets(projectId: string): Promise<{
  dry_run: BudgetState;
  recurring_content_total: BudgetState;
}> {
  const yyyymm = currentYearMonth();
  await loadOrCreateBudget(projectId, "dry_run", yyyymm);
  await loadOrCreateBudget(projectId, "recurring_content_total", yyyymm);

  const [dryRun, total] = await Promise.all([
    checkBudgetAvailable({ projectId, budgetType: "dry_run", expectedCostCents: 0 }),
    checkBudgetAvailable({
      projectId,
      budgetType: "recurring_content_total",
      expectedCostCents: 0,
    }),
  ]);
  return { dry_run: dryRun, recurring_content_total: total };
}
