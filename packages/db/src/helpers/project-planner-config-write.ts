import { db } from "../client.ts";
import { projectPlannerConfig, type ProjectPlannerConfig } from "../schema/operations.ts";

export interface UpsertProjectPlannerConfigInput {
  projectId: string;
  weeklyBudgetEur: number;
  perTypeMaxEur: Record<string, number> | null;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
}

/**
 * Spec 62.2: upsert the singleton planner-config row. `weeklyBudgetEur` is stored as
 * `numeric(10,2)` → coerced to string at the Drizzle boundary (the canonical pattern for
 * numeric columns in this codebase).
 *
 * `perTypeMaxEur === null` clears the column (sub-budget config is opt-in).
 */
export async function upsertProjectPlannerConfig(
  input: UpsertProjectPlannerConfigInput
): Promise<ProjectPlannerConfig> {
  const now = new Date();
  const values = {
    projectId: input.projectId,
    weeklyBudgetEur: input.weeklyBudgetEur.toFixed(2),
    perTypeMaxEur: input.perTypeMaxEur,
    topNSignalsAllowedOverage: input.topNSignalsAllowedOverage,
    maxOveragePerSignal: input.maxOveragePerSignal,
    updatedAt: now,
  };
  const rows = await db
    .insert(projectPlannerConfig)
    .values(values)
    .onConflictDoUpdate({
      target: projectPlannerConfig.projectId,
      set: {
        weeklyBudgetEur: values.weeklyBudgetEur,
        perTypeMaxEur: values.perTypeMaxEur,
        topNSignalsAllowedOverage: values.topNSignalsAllowedOverage,
        maxOveragePerSignal: values.maxOveragePerSignal,
        updatedAt: now,
      },
    })
    .returning();
  if (!rows[0]) throw new Error("upsertProjectPlannerConfig: returning() yielded no row");
  return rows[0];
}
