import { and, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { cronState } from "../schema/cron.ts";
import { projectPlannerConfig, type ProjectPlannerConfig } from "../schema/operations.ts";

export interface UpsertProjectPlannerConfigInput {
  projectId: string;
  weeklyBudgetEur: number;
  perTypeMaxEur: Record<string, number> | null;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
  /** Spec 62.3: per-project staleness threshold for refreshSignalsForProject. Omit to keep DB default (24). */
  signalMaxAgeHours?: number;
  /** Spec 62.7: weekly cron-trigger toggle. Omit to keep DB default (false). */
  cronEnabled?: boolean;
  /** Spec 62.7: 0=Sunday..6=Saturday. Omit to keep DB default (0). */
  cronDayOfWeek?: number;
  /** Spec 62.7: 0-23 UTC. Omit to keep DB default (18). */
  cronHourUtc?: number;
  /** Spec 63.3b: weekly comparison-discovery cron toggle. Omit to keep DB default (false). */
  comparisonCronEnabled?: boolean;
  /** Spec 63.3b: 0=Sunday..6=Saturday. Omit to keep DB default (0). */
  comparisonCronDayOfWeek?: number;
  /** Spec 63.3b: 0-23 UTC. Omit to keep DB default (6). */
  comparisonCronHourUtc?: number;
  /** Spec 63.4: trend-synthesizer cron toggle. Omit to keep DB default (false). */
  trendSynthCronEnabled?: boolean;
  /**
   * Spec 63.4: NULL = daily; 0=Sunday..6=Saturday. `null` clears the column,
   * `undefined` preserves the existing value. Omit to keep DB default (NULL = daily).
   */
  trendSynthCronDayOfWeek?: number | null;
  /** Spec 63.4: 0-23 UTC. Omit to keep DB default (1). */
  trendSynthCronHourUtc?: number;
  /**
   * Spec 63.5: cosine-similarity threshold above which the planner's
   * diversity modifier applies a malus. 0..1, default 0.5. Stored as
   * numeric(4,3) → string at the Drizzle boundary; callers pass a JS number
   * for ergonomics, the helper coerces with `.toFixed(3)`.
   */
  diversityThreshold?: number;
  /**
   * Spec 63.5: linear malus slope above the threshold. 0..2, default 0.5.
   * `0` disables diversity (existing FIFO / score-only behaviour).
   */
  diversityMalusWeight?: number;
}

/**
 * Builds the cron pattern that the orchestrator consumes for
 * planner_weekly_generation jobs: `0 <hour> * * <dayOfWeek>`. Minute is fixed
 * to 0 so multi-worker setups can't fire mid-minute on each other.
 *
 * Spec 63.3b: also used for `comparison_discovery` cron — same shape.
 */
export function buildPlannerCronPattern(dayOfWeek: number, hourUtc: number): string {
  return `0 ${hourUtc} * * ${dayOfWeek}`;
}

/**
 * Spec 63.4: trend-synthesizer cron pattern. Same minute=0 + hour=H base, but
 * supports a nullable day-of-week to express daily cadence (NULL → `*`).
 */
export function buildTrendSynthCronPattern(
  dayOfWeek: number | null,
  hourUtc: number,
): string {
  const dow = dayOfWeek === null ? "*" : String(dayOfWeek);
  return `0 ${hourUtc} * * ${dow}`;
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
 *
 * Spec 62.7: when any of `cronEnabled`, `cronDayOfWeek`, `cronHourUtc` is provided,
 * the matching `cron_state` row (job_type='planner_weekly_generation') is updated
 * inline — single source of truth for the cron schedule. The orchestrator picks up
 * the change on the next minute-tick via syncCronJobs(); UPDATE on a missing row is
 * a no-op (the worker-startup seeder owns row creation).
 */
export async function upsertProjectPlannerConfig(
  input: UpsertProjectPlannerConfigInput
): Promise<ProjectPlannerConfig> {
  const now = new Date();
  const weeklyBudgetEur = input.weeklyBudgetEur.toFixed(2);
  // Spec 63.5: numeric(4,3) → string with 3 fractional digits. `.toFixed(3)`
  // also clamps trailing-floating-point noise so the DB doesn't see
  // "0.5000000000000001" from a slider drag.
  const diversityThreshold =
    input.diversityThreshold !== undefined ? input.diversityThreshold.toFixed(3) : undefined;
  const diversityMalusWeight =
    input.diversityMalusWeight !== undefined ? input.diversityMalusWeight.toFixed(3) : undefined;
  const insertValues = {
    projectId: input.projectId,
    weeklyBudgetEur,
    perTypeMaxEur: input.perTypeMaxEur,
    topNSignalsAllowedOverage: input.topNSignalsAllowedOverage,
    maxOveragePerSignal: input.maxOveragePerSignal,
    updatedAt: now,
    ...(input.signalMaxAgeHours !== undefined ? { signalMaxAgeHours: input.signalMaxAgeHours } : {}),
    ...(input.cronEnabled !== undefined ? { cronEnabled: input.cronEnabled } : {}),
    ...(input.cronDayOfWeek !== undefined ? { cronDayOfWeek: input.cronDayOfWeek } : {}),
    ...(input.cronHourUtc !== undefined ? { cronHourUtc: input.cronHourUtc } : {}),
    ...(input.comparisonCronEnabled !== undefined
      ? { comparisonCronEnabled: input.comparisonCronEnabled }
      : {}),
    ...(input.comparisonCronDayOfWeek !== undefined
      ? { comparisonCronDayOfWeek: input.comparisonCronDayOfWeek }
      : {}),
    ...(input.comparisonCronHourUtc !== undefined
      ? { comparisonCronHourUtc: input.comparisonCronHourUtc }
      : {}),
    ...(input.trendSynthCronEnabled !== undefined
      ? { trendSynthCronEnabled: input.trendSynthCronEnabled }
      : {}),
    ...(input.trendSynthCronDayOfWeek !== undefined
      ? { trendSynthCronDayOfWeek: input.trendSynthCronDayOfWeek }
      : {}),
    ...(input.trendSynthCronHourUtc !== undefined
      ? { trendSynthCronHourUtc: input.trendSynthCronHourUtc }
      : {}),
    ...(diversityThreshold !== undefined ? { diversityThreshold } : {}),
    ...(diversityMalusWeight !== undefined ? { diversityMalusWeight } : {}),
  };
  const updateSet = {
    weeklyBudgetEur,
    perTypeMaxEur: input.perTypeMaxEur,
    topNSignalsAllowedOverage: input.topNSignalsAllowedOverage,
    maxOveragePerSignal: input.maxOveragePerSignal,
    updatedAt: now,
    ...(input.signalMaxAgeHours !== undefined ? { signalMaxAgeHours: input.signalMaxAgeHours } : {}),
    ...(input.cronEnabled !== undefined ? { cronEnabled: input.cronEnabled } : {}),
    ...(input.cronDayOfWeek !== undefined ? { cronDayOfWeek: input.cronDayOfWeek } : {}),
    ...(input.cronHourUtc !== undefined ? { cronHourUtc: input.cronHourUtc } : {}),
    ...(input.comparisonCronEnabled !== undefined
      ? { comparisonCronEnabled: input.comparisonCronEnabled }
      : {}),
    ...(input.comparisonCronDayOfWeek !== undefined
      ? { comparisonCronDayOfWeek: input.comparisonCronDayOfWeek }
      : {}),
    ...(input.comparisonCronHourUtc !== undefined
      ? { comparisonCronHourUtc: input.comparisonCronHourUtc }
      : {}),
    ...(input.trendSynthCronEnabled !== undefined
      ? { trendSynthCronEnabled: input.trendSynthCronEnabled }
      : {}),
    ...(input.trendSynthCronDayOfWeek !== undefined
      ? { trendSynthCronDayOfWeek: input.trendSynthCronDayOfWeek }
      : {}),
    ...(input.trendSynthCronHourUtc !== undefined
      ? { trendSynthCronHourUtc: input.trendSynthCronHourUtc }
      : {}),
    ...(diversityThreshold !== undefined ? { diversityThreshold } : {}),
    ...(diversityMalusWeight !== undefined ? { diversityMalusWeight } : {}),
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
  const row = rows[0];

  // Spec 62.7: sync the cron_state row. UPDATE-only — the seeder owns INSERT.
  // We use the persisted row (not the input) so omitted fields fall through to
  // DB defaults consistently.
  const touchesCron =
    input.cronEnabled !== undefined ||
    input.cronDayOfWeek !== undefined ||
    input.cronHourUtc !== undefined;
  if (touchesCron) {
    const pattern = buildPlannerCronPattern(row.cronDayOfWeek, row.cronHourUtc);
    await db
      .update(cronState)
      .set({
        cronPattern: pattern,
        isActive: row.cronEnabled,
        updatedAt: now,
      })
      .where(
        and(
          eq(cronState.projectId, input.projectId),
          eq(cronState.jobType, "planner_weekly_generation"),
        ),
      );
  }

  // Spec 63.3b: same dance for comparison_discovery cron_state row.
  const touchesComparisonCron =
    input.comparisonCronEnabled !== undefined ||
    input.comparisonCronDayOfWeek !== undefined ||
    input.comparisonCronHourUtc !== undefined;
  if (touchesComparisonCron) {
    const pattern = buildPlannerCronPattern(row.comparisonCronDayOfWeek, row.comparisonCronHourUtc);
    await db
      .update(cronState)
      .set({
        cronPattern: pattern,
        isActive: row.comparisonCronEnabled,
        updatedAt: now,
      })
      .where(
        and(
          eq(cronState.projectId, input.projectId),
          eq(cronState.jobType, "comparison_discovery"),
        ),
      );
  }

  // Spec 63.4: same dance for trends_synthesizer cron_state row. Nullable
  // dayOfWeek expresses daily cadence — buildTrendSynthCronPattern handles the
  // NULL → `*` substitution.
  const touchesTrendSynthCron =
    input.trendSynthCronEnabled !== undefined ||
    input.trendSynthCronDayOfWeek !== undefined ||
    input.trendSynthCronHourUtc !== undefined;
  if (touchesTrendSynthCron) {
    const pattern = buildTrendSynthCronPattern(
      row.trendSynthCronDayOfWeek,
      row.trendSynthCronHourUtc,
    );
    await db
      .update(cronState)
      .set({
        cronPattern: pattern,
        isActive: row.trendSynthCronEnabled,
        updatedAt: now,
      })
      .where(
        and(
          eq(cronState.projectId, input.projectId),
          eq(cronState.jobType, "trends_synthesizer"),
        ),
      );
  }

  return row;
}
