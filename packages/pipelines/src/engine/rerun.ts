// Spec 62.6 §6.8: rerun-from-step orchestration.
//
// Centralises the impact preview + cleanup logic for the "rerun" pause-resolve action.
// The HTTP layer hits `computeRerunImpact()` for the preflight; the step-pause-service
// hits `executeRerunCleanup()` immediately before re-enqueueing the pipeline. The
// runner's own switch-case (see runner.ts `case "rerun"`) handles the in-memory state
// reset; this module owns the durable DB side.
//
// Pipeline-specific destructive cleanup (planned_items rollback, etc.) is registered
// per pipeline name via `registerRerunCleanupHook()`. PlanWeekPipeline registers a
// no-op in 62.6 because `PersistPlanStep.pausableInDebug() === false` AND it's the
// last step — so no paused state can carry DB writes that need reverting.

import {
  autoDismissPausesForSteps,
  db,
  deleteIdempotencyForSteps,
  eq,
  pipelineRuns,
  supersedeStepRunsForSteps,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { pipelineRegistry } from "./registry.ts";

const log = createLogger("pipelines:rerun");

export interface RerunCleanupHookContext {
  pipelineRunId: string;
  projectId: string;
  fromStepName: string;
  fromStepIndex: number;
  /** Step names that will be invalidated (= step after fromStepName, in pipeline order). */
  laterStepNames: string[];
}

export interface RerunCleanupHook {
  /**
   * Pure read: describe what DB state will be reverted if rerun proceeds. Drives the
   * preflight impact preview. MAY return zero impact for the typical case (e.g. when
   * the persist step hasn't run yet). MUST not mutate state.
   */
  describeImpact?(ctx: RerunCleanupHookContext): Promise<{
    dbWritesToRevert: string[];
    itemsToCancel: number;
  }>;

  /**
   * Perform the destructive cleanup. Called by step-pause-service after the rerun
   * pause has been resolved and the confirm-destructive gate has been satisfied.
   * Must be idempotent — partial failure + retry should be safe.
   */
  execute(ctx: RerunCleanupHookContext): Promise<void>;
}

const cleanupHooks = new Map<string, RerunCleanupHook>();

export function registerRerunCleanupHook(pipelineName: string, hook: RerunCleanupHook): void {
  cleanupHooks.set(pipelineName, hook);
}

export function getRerunCleanupHook(pipelineName: string): RerunCleanupHook | undefined {
  return cleanupHooks.get(pipelineName);
}

/** Test-only helper — keep cleanup-hook registrations from leaking between tests. */
export function clearRerunCleanupHooksForTesting(): void {
  cleanupHooks.clear();
}

export interface RerunImpact {
  /** True when no destructive cleanup is needed and the rerun can proceed without confirmation. */
  safe: boolean;
  fromStepName: string;
  fromStepIndex: number;
  totalSteps: number;
  /** Step names that will be invalidated (later than `fromStepName`). */
  stepsToInvalidate: string[];
  /** Human-readable descriptions of DB writes that will be reverted by the cleanup hook. */
  dbWritesToRevert: string[];
  /** Items (e.g. approved planned_items already enqueued for execution) that will be cancelled. */
  itemsToCancel: number;
  /** When true, the resolve endpoint requires payload.confirmDestructive === true. */
  requiresConfirm: boolean;
}

export interface ComputeRerunImpactInput {
  pipelineName: string;
  pipelineRunId: string;
  projectId: string;
  fromStepName: string;
}

/**
 * Compute the destructive impact of a rerun BEFORE the user confirms. Stateless;
 * does not mutate the DB. The result drives the rerun-preflight HTTP endpoint
 * and the in-service confirm-destructive gate at resolve time.
 *
 * Throws when the pipeline is not registered or the step is not in its step list.
 * Routes translate those into 404 / 422.
 */
export async function computeRerunImpact(input: ComputeRerunImpactInput): Promise<RerunImpact> {
  const pipeline = pipelineRegistry.get(input.pipelineName);
  if (!pipeline) {
    throw new Error(`pipeline_not_registered:${input.pipelineName}`);
  }
  const idx = pipeline.steps.findIndex((s) => s.name === input.fromStepName);
  if (idx === -1) {
    throw new Error(`step_not_in_pipeline:${input.fromStepName} (pipeline=${input.pipelineName})`);
  }
  const laterStepNames = pipeline.steps.slice(idx + 1).map((s) => s.name);

  const hookCtx: RerunCleanupHookContext = {
    pipelineRunId: input.pipelineRunId,
    projectId: input.projectId,
    fromStepName: input.fromStepName,
    fromStepIndex: idx,
    laterStepNames,
  };

  const hook = cleanupHooks.get(input.pipelineName);
  const hookImpact = hook?.describeImpact
    ? await hook.describeImpact(hookCtx)
    : { dbWritesToRevert: [], itemsToCancel: 0 };

  const requiresConfirm = hookImpact.dbWritesToRevert.length > 0 || hookImpact.itemsToCancel > 0;

  return {
    safe: !requiresConfirm,
    fromStepName: input.fromStepName,
    fromStepIndex: idx,
    totalSteps: pipeline.steps.length,
    stepsToInvalidate: laterStepNames,
    dbWritesToRevert: hookImpact.dbWritesToRevert,
    itemsToCancel: hookImpact.itemsToCancel,
    requiresConfirm,
  };
}

export interface ExecuteRerunCleanupInput {
  pipelineName: string;
  pipelineRunId: string;
  projectId: string;
  fromStepName: string;
}

export interface RerunCleanupResult {
  /** Step name of the rerun target (echoed for logging). */
  fromStepName: string;
  /** New `priorOutput` to pass to enqueuePipeline — accumulatedOutput trimmed to steps before fromStepName. */
  trimmedPriorOutput: Record<string, unknown>;
}

/**
 * Run the durable cleanup for a rerun. Atomicity guarantees:
 * - Each helper is idempotent; partial-failure recovery is "retry the rerun".
 * - The hook runs LAST so any DB writes it makes don't get rolled back by an
 *   earlier idempotency-cache delete throwing.
 *
 * Returns the trimmed `priorOutput` map that the caller passes into enqueuePipeline
 * so the runner re-enters with steps 1..N-1 already accounted for.
 */
export async function executeRerunCleanup(
  input: ExecuteRerunCleanupInput
): Promise<RerunCleanupResult> {
  const pipeline = pipelineRegistry.get(input.pipelineName);
  if (!pipeline) {
    throw new Error(`pipeline_not_registered:${input.pipelineName}`);
  }
  const idx = pipeline.steps.findIndex((s) => s.name === input.fromStepName);
  if (idx === -1) {
    throw new Error(`step_not_in_pipeline:${input.fromStepName} (pipeline=${input.pipelineName})`);
  }
  const laterStepNames = pipeline.steps.slice(idx + 1).map((s) => s.name);
  const stepNamesToInvalidate = [input.fromStepName, ...laterStepNames];

  // 1. Mark later child step-run rows as superseded so the UI shows them struck-through.
  const supersededCount = await supersedeStepRunsForSteps({
    parentRunId: input.pipelineRunId,
    stepNames: stepNamesToInvalidate,
  });

  // 2. Auto-dismiss any unresolved pauses for later steps (the current pause is
  //    resolved by the caller via dbResolveStepPause with action='rerun').
  const dismissedCount = await autoDismissPausesForSteps({
    pipelineRunId: input.pipelineRunId,
    stepNames: laterStepNames,
    reason: `rerun from ${input.fromStepName}`,
  });

  // 3. Drop idempotency-cache entries for these steps so they recompute fresh.
  const deletedIdem = await deleteIdempotencyForSteps({
    projectId: input.projectId,
    pipelineName: input.pipelineName,
    stepNames: stepNamesToInvalidate,
  });

  // 4. Trim the accumulatedOutput on suspensionCheckpoint. The runner reads this
  //    back as priorOutput, so trimming here prevents the resume from skipping
  //    steps that we just invalidated.
  const [parentRow] = await db
    .select({ suspensionCheckpoint: pipelineRuns.suspensionCheckpoint })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, input.pipelineRunId))
    .limit(1);
  const checkpoint = parentRow?.suspensionCheckpoint as {
    kind?: string;
    stepKey?: string;
    accumulatedOutput?: Record<string, unknown>;
  } | null;
  const trimmedPriorOutput: Record<string, unknown> = {};
  if (checkpoint?.accumulatedOutput && typeof checkpoint.accumulatedOutput === "object") {
    for (const [k, v] of Object.entries(checkpoint.accumulatedOutput)) {
      if (!stepNamesToInvalidate.includes(k)) {
        trimmedPriorOutput[k] = v;
      }
    }
  }
  // Best-effort: also clear the checkpoint so the UI doesn't show stale "paused at X"
  // metadata during the brief window between cleanup and re-enqueue.
  await db
    .update(pipelineRuns)
    .set({ suspensionCheckpoint: null })
    .where(eq(pipelineRuns.id, input.pipelineRunId));

  // 5. Pipeline-specific destructive cleanup last (planned_items rollback etc.).
  const hook = cleanupHooks.get(input.pipelineName);
  if (hook) {
    await hook.execute({
      pipelineRunId: input.pipelineRunId,
      projectId: input.projectId,
      fromStepName: input.fromStepName,
      fromStepIndex: idx,
      laterStepNames,
    });
  }

  log.info(
    {
      pipelineRunId: input.pipelineRunId,
      pipelineName: input.pipelineName,
      fromStepName: input.fromStepName,
      supersededCount,
      dismissedCount,
      deletedIdem,
      hadHook: !!hook,
    },
    "Rerun cleanup complete"
  );

  return {
    fromStepName: input.fromStepName,
    trimmedPriorOutput,
  };
}
