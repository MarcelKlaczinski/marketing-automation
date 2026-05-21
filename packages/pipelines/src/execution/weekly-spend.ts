// Spec 62.8: weekly spend + budget helpers for the execute-plan budget gate.
//
// Sums `cost_logs` for one project across an ISO week (Mon 00:00 UTC →
// next Mon 00:00 UTC). The plan-execution worker calls this before each item
// to decide whether enqueuing the item would push cumulative spend above 90%
// of `project_planner_config.weekly_budget_eur`.

import {
  and,
  costLogs,
  db,
  eq,
  gte,
  lt,
  projectPlannerConfig,
  sql,
} from "@marketing-auto/db";

/**
 * Sum cost_logs for one project in the [weekStart, weekStart + 7d) range.
 * Returns 0 when no rows match. Caller is responsible for passing the
 * monday-00:00-UTC boundary that matches the plan's iso_week — use
 * `isoWeekStartDate(year, isoWeek)` from `@marketing-auto/planner`.
 */
export async function getWeeklySpendEur(input: {
  projectId: string;
  weekStartUtc: Date;
}): Promise<number> {
  const weekEnd = new Date(input.weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
    })
    .from(costLogs)
    .where(
      and(
        eq(costLogs.projectId, input.projectId),
        gte(costLogs.createdAt, input.weekStartUtc),
        lt(costLogs.createdAt, weekEnd),
      ),
    );
  return Number.parseFloat(row?.total ?? "0");
}

/**
 * Read the weekly budget from `project_planner_config`. Returns `null` when
 * the project has no planner config row — the caller treats `null` as "no
 * budget enforcement" (Toolwiki always has a config; defensive against the
 * "new project pre-config" race).
 */
export async function getWeeklyBudgetEur(projectId: string): Promise<number | null> {
  const [row] = await db
    .select({ weeklyBudgetEur: projectPlannerConfig.weeklyBudgetEur })
    .from(projectPlannerConfig)
    .where(eq(projectPlannerConfig.projectId, projectId))
    .limit(1);
  if (!row) return null;
  const parsed = Number.parseFloat(row.weeklyBudgetEur);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Hard 90% gate used by `executePlan()`. Returns `{ allowed: true }` when
 * spending the additional `extraCostEur` would stay at or below
 * `budget * 0.9`. The 10% buffer guards against LLM estimation drift (per
 * Spec 62.8 §2.5).
 */
export interface BudgetGateInput {
  projectId: string;
  weekStartUtc: Date;
  extraCostEur: number;
}

export type BudgetGateResult =
  | { allowed: true; spend: number; budget: number | null; threshold: number | null }
  | {
      allowed: false;
      reason: "budget_gate";
      spend: number;
      budget: number;
      threshold: number;
    };

export async function checkWeeklyBudgetGate(
  input: BudgetGateInput,
): Promise<BudgetGateResult> {
  const [spend, budget] = await Promise.all([
    getWeeklySpendEur({ projectId: input.projectId, weekStartUtc: input.weekStartUtc }),
    getWeeklyBudgetEur(input.projectId),
  ]);
  // No budget configured = no gate. Defensive only — Toolwiki always has one.
  if (budget === null) {
    return { allowed: true, spend, budget: null, threshold: null };
  }
  const threshold = budget * 0.9;
  if (spend + input.extraCostEur > threshold) {
    return {
      allowed: false,
      reason: "budget_gate",
      spend,
      budget,
      threshold,
    };
  }
  return { allowed: true, spend, budget, threshold };
}
