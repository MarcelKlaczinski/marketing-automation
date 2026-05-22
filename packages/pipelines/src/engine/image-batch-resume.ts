// Spec 64.7: Resume a suspended pipeline after Google Gemini Image Batch
// delivers its result. Called by image-batch-processor.worker.ts in apps/api.
//
// Memory D130: this module owns the mutations (DB updates + enqueuePipeline);
// the worker is a thin wrapper that just calls into it.

import type { ImageBatchRequest, SuspensionCheckpoint } from "@marketing-auto/db";
import {
  db,
  eq,
  imageBatchRequests,
  pipelineRuns,
  supersedeOldSubstep,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { enqueuePipeline } from "./queue.ts";

const log = createLogger("pipelines:image-batch-resume");

/**
 * Re-enqueues the pipeline that suspended waiting for an image batch result.
 * The runner skips all steps before `resumeFromStep` (priorOutput restored
 * from the checkpoint's accumulatedOutput) and injects the image result as
 * `ctx.batchResult` so HeroImageStep's batch-resume branch picks it up.
 *
 * On the failure path (`status='failed'`, no responseBody), the function still
 * re-enqueues the pipeline with `batchResult.content` carrying the error blob;
 * HeroImageStep's resume branch checks for the error field and falls through
 * to its graceful-skip path so the article lands in final_review without a
 * hero rather than failing the whole pipeline.
 */
export async function resumeImageBatchPipeline(row: ImageBatchRequest): Promise<void> {
  if (!row.pipelineRunId) {
    log.warn(
      { imageBatchRequestId: row.id },
      "Image-batch row has no pipelineRunId — skipping resume",
    );
    return;
  }

  // Only act on completed/failed terminal rows — defensive: the worker is
  // expected to filter before calling, but a duplicate call shouldn't re-enqueue.
  if (row.status !== "completed" && row.status !== "failed") {
    log.warn(
      { imageBatchRequestId: row.id, status: row.status },
      "Image-batch row not yet terminal — skipping resume",
    );
    return;
  }

  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, row.pipelineRunId))
    .limit(1);
  if (!run) {
    log.warn({ pipelineRunId: row.pipelineRunId }, "Pipeline run not found — skipping resume");
    return;
  }

  if (run.status !== "batch_pending") {
    log.info(
      { pipelineRunId: run.id, status: run.status },
      "Pipeline run not batch_pending — skipping resume (already processed?)",
    );
    return;
  }

  const checkpoint = run.suspensionCheckpoint as unknown as SuspensionCheckpoint | null;
  if (!checkpoint?.stepKey) {
    log.warn({ pipelineRunId: run.id }, "No checkpoint on batch_pending run — skipping resume");
    return;
  }
  // Defensive (Spec 64.7): refuse to resume an image-batch row if the checkpoint
  // is NOT a kind='image_batch'. This guards against a race where the
  // Anthropic and image processors both look up the same pipeline_run id.
  if ("kind" in checkpoint && checkpoint.kind !== "image_batch") {
    log.warn(
      { pipelineRunId: run.id, kind: checkpoint.kind },
      "Refusing to image-batch-resume a non-image_batch checkpoint",
    );
    return;
  }

  // Build the ctx.batchResult content: JSON-encoded image result blob.
  // HeroImageStep's resume branch parses this back into { r2Key, publicUrl,
  // costEur, seed, error? }.
  // Memory D129: explicit existence check on the response body — a completed
  // row WITHOUT response_body is a worker bug; refuse to silently default.
  // (Column is already typed `$type<ImageBatchResponseBody>()` so no cast needed.)
  const responseBody = row.responseBody;
  if (row.status === "completed" && (responseBody === null || responseBody === undefined)) {
    log.error(
      { imageBatchRequestId: row.id },
      "completed image_batch_requests row has NULL response_body — cannot resume",
    );
    return;
  }

  const content =
    row.status === "failed"
      ? JSON.stringify({
          r2Key: "",
          publicUrl: "",
          costEur: 0,
          seed: null,
          error: row.errorMessage ?? "Image batch failed (no error message)",
        })
      : JSON.stringify(responseBody);

  log.info(
    { pipelineRunId: run.id, stepKey: checkpoint.stepKey, imageBatchRequestId: row.id, status: row.status },
    "Resuming suspended pipeline from image batch",
  );

  // Spec 62.0a Section 4.5.1: supersede the substep row that returned the
  // suspension signal before the runner re-enters and creates a new substep.
  const supersededCount = await supersedeOldSubstep(run.id, checkpoint.stepKey);
  if (supersededCount > 0) {
    log.info(
      { pipelineRunId: run.id, stepKey: checkpoint.stepKey, supersededCount },
      "Superseded stale substep rows before image-batch-resume",
    );
  }

  // Mark the run as queued again so the UI reflects the re-enqueue.
  await db
    .update(pipelineRuns)
    .set({ status: "queued", suspensionCheckpoint: null })
    .where(eq(pipelineRuns.id, run.id));

  await enqueuePipeline({
    pipelineName: run.pipelineName,
    projectId: row.projectId,
    input: (run.input ?? {}) as Record<string, unknown>,
    preRunId: run.id,
    resumeFromStep: checkpoint.stepKey,
    batchResult: { stepKey: checkpoint.stepKey, content },
    priorOutput: checkpoint.accumulatedOutput,
  });

  // Move the image_batch_requests row to terminal "resume_enqueued" to avoid
  // double-processing if the worker re-scans before the pipeline finishes.
  await db
    .update(imageBatchRequests)
    .set({ status: "resume_enqueued", updatedAt: new Date() })
    .where(eq(imageBatchRequests.id, row.id));
}
