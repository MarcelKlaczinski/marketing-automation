import { enqueuePipeline, type StepPauseResume } from "@marketing-auto/pipelines";
import {
  db,
  eq,
  getStepPauseById,
  pipelineRuns,
  resolveStepPause as dbResolveStepPause,
  stepPauses,
} from "@marketing-auto/db";
import type { StepPause } from "@marketing-auto/db";
import { createLogger, type StepPausePayload } from "@marketing-auto/shared";

const log = createLogger("step-pause-service");

export type StepPauseResolveResult =
  | { ok: true; resolved: StepPause; reEnqueued: boolean; jobId: string | null }
  | { ok: false; status: 404 | 409 | 422; error: string };

/**
 * Spec 62.0a Section 6: resolve a paused step.
 *
 * Flow:
 * 1. Load the step_pauses row by id. 404 if missing.
 * 2. For `extract-for-optimization`: persist the user_note + action ONLY (resolved_at stays
 *    NULL so the pause stays visible in the unresolved index); do NOT re-enqueue. The UI
 *    keeps showing the pause as active. Returns ok=true with reEnqueued=false.
 * 3. For all other user actions: atomically UPDATE the row (resolved_at + action + edited fields).
 *    The atomic guard `WHERE resolved_at IS NULL` returns null if a concurrent resolve already won
 *    → 409.
 * 4. Load the parent pipeline_runs row to recover `suspensionCheckpoint.accumulatedOutput`
 *    (= priorOutput at suspend time).
 * 5. Re-enqueue the pipeline with stepPauseResume + priorOutput. The runner re-enters,
 *    applies the action, and continues / re-suspends / aborts.
 */
export async function resolveStepPause(
  stepPauseId: string,
  payload: StepPausePayload,
  resolvedBy: string
): Promise<StepPauseResolveResult> {
  const existing = await getStepPauseById(stepPauseId);
  if (!existing) {
    return { ok: false, status: 404, error: "step_pause_not_found" };
  }

  // extract-for-optimization: tag the row but keep it unresolved + no re-enqueue.
  // The Zod superRefine in stepPausePayloadSchema already requires userNote here.
  if (payload.action === "extract-for-optimization") {
    if (existing.resolvedAt) {
      return { ok: false, status: 409, error: "already_resolved" };
    }
    const [updated] = await db
      .update(stepPauses)
      .set({
        action: "extract-for-optimization",
        userNote: payload.userNote ?? existing.userNote,
      })
      .where(eq(stepPauses.id, stepPauseId))
      .returning();
    log.info(
      { stepPauseId, stepName: existing.stepName },
      "Step-pause flagged for optimization — pipeline remains paused"
    );
    return { ok: true, resolved: updated ?? existing, reEnqueued: false, jobId: null };
  }

  // All other actions atomically resolve the row.
  const resolveInput: Parameters<typeof dbResolveStepPause>[0] = {
    stepPauseId,
    action: payload.action,
    resolvedBy,
  };
  if (payload.editedInput !== undefined) {
    resolveInput.editedInput = payload.editedInput as Record<string, unknown>;
  }
  if (payload.editedOutput !== undefined) {
    resolveInput.editedOutput = payload.editedOutput as Record<string, unknown>;
  }
  if (payload.editedPrompt !== undefined) resolveInput.editedPrompt = payload.editedPrompt;
  if (payload.userNote !== undefined) resolveInput.userNote = payload.userNote;

  const resolved = await dbResolveStepPause(resolveInput);
  if (!resolved) {
    return { ok: false, status: 409, error: "already_resolved" };
  }

  // Abort short-circuits the re-enqueue — the runner already marked the parent run cancelled
  // via the resume switch-case. But we still need to send the action to the runner so it
  // auto-dismisses any sibling pauses. Re-enqueue with `action: abort` does exactly that.
  // (Alternatively we could update pipelineRuns.status here — but consistency is cleaner.)

  // Recover priorOutput from the parent run's checkpoint (set at suspend by the runner).
  const [parentRun] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, resolved.pipelineRunId))
    .limit(1);
  if (!parentRun) {
    return { ok: false, status: 404, error: "pipeline_run_not_found" };
  }
  if (parentRun.status !== "paused") {
    log.warn(
      { runId: parentRun.id, status: parentRun.status, stepPauseId },
      "Parent run is not in 'paused' state at resolve time — proceeding anyway"
    );
  }

  const checkpoint = parentRun.suspensionCheckpoint as
    | { kind?: string; stepKey?: string; accumulatedOutput?: Record<string, unknown> }
    | null;
  const priorOutput: Record<string, unknown> =
    checkpoint?.accumulatedOutput && typeof checkpoint.accumulatedOutput === "object"
      ? checkpoint.accumulatedOutput
      : {};

  const stepPauseResume: StepPauseResume = {
    stepName: resolved.stepName,
    action: payload.action,
    storedOutput: resolved.stepOutput,
    stepPauseId: resolved.id,
  };
  if (payload.editedInput !== undefined) stepPauseResume.editedInput = payload.editedInput;
  if (payload.editedOutput !== undefined) stepPauseResume.editedOutput = payload.editedOutput;
  if (payload.editedPrompt !== undefined) stepPauseResume.editedPrompt = payload.editedPrompt;

  // Re-enqueue. preRunId reuses the parent pipeline_runs row so the UI keeps the same runId.
  // jobId uses a fresh timestamp suffix so BullMQ does not dedupe against the prior enqueue.
  const { jobId } = await enqueuePipeline({
    pipelineName: parentRun.pipelineName,
    projectId: parentRun.projectId,
    input: (parentRun.input ?? {}) as Record<string, unknown>,
    preRunId: parentRun.id,
    priorOutput,
    stepPauseResume,
    runMode: "debug",
    jobOptions: { jobId: `step-pause-resume-${resolved.id}-${Date.now()}` },
  });

  // Flip parent run back to 'running' so the UI reflects the re-enqueue. The runner will
  // immediately UPDATE on entry to the same status, which is a benign no-op.
  await db
    .update(pipelineRuns)
    .set({ status: "running", suspensionCheckpoint: null })
    .where(eq(pipelineRuns.id, parentRun.id));

  return { ok: true, resolved, reEnqueued: true, jobId };
}
