// Spec 61.4: Resume a suspended pipeline after Anthropic Batch API delivers its result.
// Called by the batch processor worker (apps/api/src/workers/batch-processor.worker.ts).
import type { BatchRequest, SuspensionCheckpoint } from "@marketing-auto/db";
import {
  batchRequests,
  db,
  eq,
  pipelineRuns,
  supersedeOldSubstep,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { enqueuePipeline } from "./queue.ts";

const log = createLogger("pipelines:batch-resume");

/**
 * Re-enqueues the pipeline that suspended waiting for a batch result.
 * The runner will skip all steps before `resumeFromStep` (they're in priorOutput)
 * and inject the LLM content from the batch as `ctx.batchResult`.
 */
export async function resumePipeline(batchRow: BatchRequest): Promise<void> {
  if (!batchRow.pipelineRunId) {
    log.warn({ batchRequestId: batchRow.id }, "Batch row has no pipelineRunId — skipping resume");
    return;
  }

  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, batchRow.pipelineRunId))
    .limit(1);

  if (!run) {
    log.warn({ pipelineRunId: batchRow.pipelineRunId }, "Pipeline run not found — skipping resume");
    return;
  }

  if (run.status !== "batch_pending") {
    log.info(
      { pipelineRunId: run.id, status: run.status },
      "Pipeline run is not batch_pending — skipping resume (already processed?)"
    );
    return;
  }

  const checkpoint = run.suspensionCheckpoint as unknown as SuspensionCheckpoint | null;
  if (!checkpoint?.stepKey) {
    log.warn({ pipelineRunId: run.id }, "No checkpoint on batch_pending run — skipping resume");
    return;
  }
  // Defensive: a step-pause checkpoint must never reach the batch-resume code path —
  // batch_pending runs only ever carry `kind: "batch"` (or legacy rows pre-62.0a-followup
  // with no `kind` field at all, which we assume to be batch since the run status is
  // batch_pending). Bail out if we ever see a step_pause checkpoint here.
  if ("kind" in checkpoint && checkpoint.kind === "step_pause") {
    log.warn(
      { pipelineRunId: run.id, kind: checkpoint.kind },
      "Refusing to batch-resume a step-pause checkpoint"
    );
    return;
  }

  const responseBody = batchRow.responseBody as { content?: string } | null;
  const content = responseBody?.content ?? "";

  log.info(
    { pipelineRunId: run.id, stepKey: checkpoint.stepKey, batchRequestId: batchRow.id },
    "Resuming suspended pipeline"
  );

  // Spec 62.0a Section 4.5.1: the substep row for `checkpoint.stepKey` is the one that
  // returned batchPending. It's still status='running' (or 'batch_pending' depending on path)
  // — mark it superseded before the runner re-enters and creates a new substep row.
  // Resolves the Pre-flight Task 1 cosmetic orphan-substep issue at its structural root.
  const supersededCount = await supersedeOldSubstep(run.id, checkpoint.stepKey);
  if (supersededCount > 0) {
    log.info(
      { pipelineRunId: run.id, stepKey: checkpoint.stepKey, supersededCount },
      "Superseded stale substep rows before batch-resume"
    );
  }

  // Mark the pipeline run as queued again so the UI reflects the re-enqueue
  await db
    .update(pipelineRuns)
    .set({ status: "queued", suspensionCheckpoint: null })
    .where(eq(pipelineRuns.id, run.id));

  await enqueuePipeline({
    pipelineName: run.pipelineName,
    projectId: batchRow.projectId,
    input: (run.input ?? {}) as Record<string, unknown>,
    // Re-use the same pipeline_runs row so the UI keeps the same runId
    preRunId: run.id,
    resumeFromStep: checkpoint.stepKey,
    batchResult: { stepKey: checkpoint.stepKey, content },
    priorOutput: checkpoint.accumulatedOutput,
  });

  // Mark the batch_requests row as "resume_enqueued" to avoid double-processing
  await db
    .update(batchRequests)
    .set({ status: "resume_enqueued", updatedAt: new Date() })
    .where(eq(batchRequests.id, batchRow.id));
}
