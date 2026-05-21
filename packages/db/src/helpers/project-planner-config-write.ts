import { db } from "../client.ts";
import { projectPlannerConfig, type ProjectPlannerConfig } from "../schema/operations.ts";

export interface UpsertProjectPlannerConfigInput {
  projectId: string;
  weeklyBudgetEur: number;
  perTypeMaxEur: Record<string, number> | null;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
  /** Spec 62.3: per-project staleness threshold for refreshSignalsForProject. Omit to keep DB default (24). */
  signalMaxAgeHours?: number;
}

/**
 * Spec 62.2: upsert the singleton planner-config row. `weeklyBudgetEur` is stored as
 * `numeric(10,2)` → coerced to string at the Drizzle boundary (the canonical pattern for
 * numeric columns in this codebase).
 *
 * `perTypeMaxEur === null` clears the column (sub-budget config is opt-in).
 *
 * Spec 62.3: `signalMaxAgeHours` controls per-source refresh staleness gating. When
 * omitted the DB default (24) is used; on update the previous value is preserved.
 */
export async function upsertProjectPlannerConfig(
  input: UpsertProjectPlannerConfigInput
): Promise<ProjectPlannerConfig> {
  const now = new Date();
  const weeklyBudgetEur = input.weeklyBudgetEur.toFixed(2);
  const insertValues = {
    projectId: input.projectId,
    weeklyBudgetEur,
    perTypeMaxEur: input.perTypeMaxEur,
    topNSignalsAllowedOverage: input.topNSignalsAllowedOverage,
    maxOveragePerSignal: input.maxOveragePerSignal,
    updatedAt: now,
    ...(input.signalMaxAgeHours !== undefined ? { signalMaxAgeHours: input.signalMaxAgeHours } : {}),
  };
  const updateSet = {
    weeklyBudgetEur,
    perTypeMaxEur: input.perTypeMaxEur,
    topNSignalsAllowedOverage: input.topNSignalsAllowedOverage,
    maxOveragePerSignal: input.maxOveragePerSignal,
    updatedAt: now,
    ...(input.signalMaxAgeHours !== undefined ? { signalMaxAgeHours: input.signalMaxAgeHours } : {}),
  };
  const rows = await db
    .insert(projectPlannerConfig)
    .values(insertValues)
    .onConflictDoUpdate({
      target: projectPlannerConfig.projectId,
      set: updateSet,
    })
    .returning();
  if (!rows[0]) throw new Error("upsertProjectPlannerConfig: returning() yielded no row");
  return rows[0];
}
