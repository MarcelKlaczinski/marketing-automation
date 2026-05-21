import { publishPipelineEvent } from "@marketing-auto/core/events";
import {
  createOptimizationRequest,
  db,
  resolveStepPause as dbResolveStepPause,
  eq,
  getStepPauseById,
  pipelineRuns,
  stepPauses,
} from "@marketing-auto/db";
import type { StepPause } from "@marketing-auto/db";
import {
  type RerunImpact,
  type StepPauseResume,
  computeRerunImpact,
  enqueuePipeline,
  executeRerunCleanup,
} from "@marketing-auto/pipelines";
import { type StepPausePayload, createLogger } from "@marketing-auto/shared";

const log = createLogger("step-pause-service");

export type StepPauseResolveResult =
  | { ok: true; resolved: StepPause; reEnqueued: boolean; jobId: string | null }
  | {
      ok: false;
      status: 409;
      error: "destructive_confirm_needed";
      impact: RerunImpact;
    }
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
  // Spec 62.0b Section 5.2: ALSO insert a frozen snapshot into step_optimization_requests
  // so Marcel can later query "what did I flag for review" without joining through pauses.
  if (payload.action === "extract-for-optimization") {
    if (existing.resolvedAt) {
      return { ok: false, status: 409, error: "already_resolved" };
    }
    const userNote = payload.userNote ?? existing.userNote;
    if (!userNote) {
      // Defensive: Zod superRefine should have caught this, but the existing row may have
      // had its userNote stripped by a prior action that didn't require one.
      return { ok: false, status: 422, error: "user_note_required" };
    }
    const [updated] = await db
      .update(stepPauses)
      .set({
        action: "extract-for-optimization",
        userNote,
      })
      .where(eq(stepPauses.id, stepPauseId))
      .returning();

    // Spec 62.0b: persist the frozen snapshot. If this fails the pause-tagging above
    // has already committed; log loudly so we know to reconcile manually, but still
    // return success because the user-visible step (the tag) succeeded.
    try {
      await createOptimizationRequest({
        stepPauseId: existing.id,
        stepName: existing.stepName,
        pipelineName: existing.pipelineName,
        projectId: existing.projectId,
        stepInput: existing.stepInput,
        stepOutput: existing.stepOutput,
        promptUsed: existing.promptUsed,
        userNote,
        requestedBy: resolvedBy,
      });
    } catch (err) {
      log.warn(
        { err, stepPauseId, stepName: existing.stepName },
        "Failed to create step_optimization_request — pause tagged but snapshot missing"
      );
    }

    log.info(
      { stepPauseId, stepName: existing.stepName },
      "Step-pause flagged for optimization — pipeline remains paused"
    );
    // Spec 62.6: extract-for-optimization is also a step resolution (just doesn't re-enqueue).
    // The UI still wants to know the row was tagged so it can refresh the action panel.
    void publishPipelineEvent(existing.projectId, {
      type: "step.resolved",
      runId: existing.pipelineRunId,
      pipelineName: existing.pipelineName,
      stepName: existing.stepName,
      stepPauseId,
      action: "extract-for-optimization",
      reEnqueued: false,
      timestamp: new Date().toISOString(),
    });
    return { ok: true, resolved: updated ?? existing, reEnqueued: false, jobId: null };
  }

  // Spec 62.6 §6.8: rerun has an extra confirm-destructive pre-flight. We re-run
  // the impact computation at resolve time (the preflight result the UI showed
  // is advisory only — could be stale if a concurrent action mutated state).
  if (payload.action === "rerun") {
    if (existing.resolvedAt) {
      return { ok: false, status: 409, error: "already_resolved" };
    }
    let impact: RerunImpact;
    try {
      impact = await computeRerunImpact({
        pipelineName: existing.pipelineName,
        pipelineRunId: existing.pipelineRunId,
        projectId: existing.projectId,
        fromStepName: existing.stepName,
      });
    } catch (err) {
      log.warn({ err, stepPauseId }, "rerun impact computation failed");
      return { ok: false, status: 422, error: "rerun_impact_failed" };
    }
    if (impact.requiresConfirm && payload.confirmDestructive !== true) {
      return {
        ok: false,
        status: 409,
        error: "destructive_confirm_needed",
        impact,
      };
    }
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

  const checkpoint = parentRun.suspensionCheckpoint as {
    kind?: string;
    stepKey?: string;
    accumulatedOutput?: Record<string, unknown>;
  } | null;
  let priorOutput: Record<string, unknown> =
    checkpoint?.accumulatedOutput && typeof checkpoint.accumulatedOutput === "object"
      ? checkpoint.accumulatedOutput
      : {};

  // Spec 62.6 §6.8: rerun cleanup runs AFTER the pause is resolved (so the
  // snapshot of the rerun action is durably recorded for audit) but BEFORE
  // re-enqueue (so the runner doesn't pick up stale child substep rows or
  // idempotency cache entries from before the rerun).
  if (payload.action === "rerun") {
    try {
      const cleanup = await executeRerunCleanup({
        pipelineName: parentRun.pipelineName,
        pipelineRunId: parentRun.id,
        projectId: parentRun.projectId,
        fromStepName: resolved.stepName,
      });
      priorOutput = cleanup.trimmedPriorOutput;
    } catch (err) {
      log.error(
        { err, stepPauseId, pipelineRunId: parentRun.id, stepName: resolved.stepName },
        "rerun cleanup failed — pause is resolved but re-enqueue would resume from stale state"
      );
      return { ok: false, status: 422, error: "rerun_cleanup_failed" };
    }
  }

  const stepPauseResume: StepPauseResume = {
    stepName: resolved.stepName,
    action: payload.action,
    storedOutput: resolved.stepOutput,
    stepPauseId: resolved.id,
    // Spec 62.0b: threaded through to prompt_versions.created_by on promote-golden.
    resolvedBy,
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

  // Spec 62.6: SSE events so RunDetail + RunsList flip without a refresh. Fire
  // both step.resolved AND run.statusChanged (paused → running) so the UI can
  // update the step card AND the run header in one event-loop tick.
  const ts = new Date().toISOString();
  void publishPipelineEvent(parentRun.projectId, {
    type: "step.resolved",
    runId: parentRun.id,
    pipelineName: parentRun.pipelineName,
    stepName: resolved.stepName,
    stepPauseId: resolved.id,
    action: payload.action,
    reEnqueued: true,
    timestamp: ts,
  });
  void publishPipelineEvent(parentRun.projectId, {
    type: "run.statusChanged",
    runId: parentRun.id,
    pipelineName: parentRun.pipelineName,
    oldStatus: parentRun.status,
    newStatus: "running",
    timestamp: ts,
  });

  return { ok: true, resolved, reEnqueued: true, jobId };
}
