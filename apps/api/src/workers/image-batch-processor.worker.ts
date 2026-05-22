// Spec 64.7: Image-batch processor worker.
//
// Two repeatable BullMQ jobs (mirrors batch-processor.worker.ts shape):
//
//   submit-pending-image-batches  every 2 min
//     - Finds approved plans with N≥1 pending image_batch_requests rows
//       AND no submitted batch yet (plan.image_batch_id IS NULL).
//     - Calls submitPlanImageBatch(planId) for each. Marcel-confirmed cadence
//       — */2 with a 90-second age buffer absorbs the HeroImageStep submit
//       lag (pipelines take 5-10 min to reach step 11/13) without burst-
//       submitting before the whole plan has hit HeroImageStep.
//
//   process-image-batch-results  every 1 hour
//     - Walks distinct gemini_batch_id values with status='submitted', calls
//       nanoBanana.retrieveBatch + fetchBatchResults, writes results back to
//       image_batch_requests, logs actual cost, calls resumeImageBatchPipeline.
//
// Memory D130: mutations live in @marketing-auto/pipelines (image-batch-resume
// + plan-image-batch-coordinator); this worker is a thin scheduling wrapper.

import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import { fetchBatchResults, retrieveBatch } from "@marketing-auto/adapter-nano-banana";
import { COST_OPS } from "@marketing-auto/core/cost";
import { nanoBananaImageCostEur } from "@marketing-auto/cost-tracker";
import {
  type ImageBatchResponseBody,
  and,
  costLogs,
  db,
  eq,
  imageBatchRequests,
  inArray,
  isNull,
  sql,
  weeklyPlans,
} from "@marketing-auto/db";
import { resumeImageBatchPipeline } from "@marketing-auto/pipelines/image-batch-resume";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { submitPlanImageBatch } from "../lib/plan-image-batch-coordinator.ts";

const log = createLogger("image-batch-processor-worker");

const QUEUE_NAME = "image-batch-processor";
const SUBMIT_JOB = "submit-pending-image-batches";
const PROCESS_JOB = "process-image-batch-results";

// 90-second age buffer between row creation and submit eligibility. Absorbs
// the transactional race where a pipeline-level batch-suspend writes the
// pending row a few seconds before its sibling rows in the same plan land.
// Without this buffer, the */2 cron could submit a single-row batch while
// other rows are still incoming.
const SUBMIT_AGE_BUFFER_MS = 90_000;

let _connection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker | null = null;

function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

// ─── Submit pending — one batch per plan ──────────────────────────────────────

async function submitPendingBatches(): Promise<void> {
  // Find plan ids with pending image_batch_requests rows older than the
  // age buffer AND whose plan has no image_batch_id yet. The age buffer is
  // applied at the row level (not the plan level) so a plan with one fresh
  // pending row + four 5-min-old rows waits the full buffer for the fresh
  // one to settle before we submit anything.
  const ageCutoff = new Date(Date.now() - SUBMIT_AGE_BUFFER_MS);
  const eligiblePlans = await db
    .selectDistinct({ planId: imageBatchRequests.weeklyPlanId })
    .from(imageBatchRequests)
    .innerJoin(weeklyPlans, eq(weeklyPlans.id, imageBatchRequests.weeklyPlanId))
    .where(
      and(
        eq(imageBatchRequests.status, "pending"),
        isNull(weeklyPlans.imageBatchId),
        // Buffer: the OLDEST pending row in the plan must be at least N seconds
        // old. We approximate this by filtering rows directly; if any row is
        // young enough to skip, the plan won't appear (because we'd want to
        // batch ALL its pending rows together). Implemented via a NOT EXISTS
        // subquery via sql template.
        sql`NOT EXISTS (
          SELECT 1 FROM ${imageBatchRequests} AS ibr_young
          WHERE ibr_young.weekly_plan_id = ${imageBatchRequests.weeklyPlanId}
            AND ibr_young.status = 'pending'
            AND ibr_young.created_at > ${ageCutoff.toISOString()}
        )`
      )
    );

  const planIds = eligiblePlans
    .map((p) => p.planId)
    .filter((id): id is string => typeof id === "string");

  if (planIds.length === 0) {
    log.debug("submitPendingBatches: no eligible plans");
    return;
  }

  log.info({ planCount: planIds.length, planIds }, "submitPendingBatches: dispatching per plan");

  for (const planId of planIds) {
    try {
      const result = await submitPlanImageBatch(planId);
      log.info({ planId, result }, "submitPlanImageBatch: done");
    } catch (err) {
      log.error({ err, planId }, "submitPlanImageBatch: threw");
    }
  }
}

// ─── Process completed batches ────────────────────────────────────────────────

async function processBatches(): Promise<void> {
  // Get distinct batch ids that are in-flight.
  const inFlight = await db
    .selectDistinct({ batchId: imageBatchRequests.geminiBatchId })
    .from(imageBatchRequests)
    .where(eq(imageBatchRequests.status, "submitted"));

  const batchIds = inFlight
    .map((r) => r.batchId)
    .filter((id): id is string => id !== null && id.length > 0);

  if (batchIds.length === 0) {
    log.debug("processBatches: no in-flight batches");
    return;
  }

  log.info({ count: batchIds.length }, "processBatches: polling Gemini batches");

  for (const batchId of batchIds) {
    try {
      await processSingleBatch(batchId);
    } catch (err) {
      log.error({ err, batchId }, "processBatches: error processing batch");
    }
  }
}

/**
 * Process one in-flight Gemini batch end-to-end: poll status → if succeeded,
 * fetch results, pipe each Gemini byte payload through `convertImageToWebp`
 * (Pattern 119: magic-byte sniff + sharp conversion + forensic original
 * side-by-side), write per-row `responseBody` + cost log, resume the pipeline.
 *
 * Spec 64.15 Phase A: the convertImageToWebp hop is THIS worker's job —
 * adapter `fetchBatchResults` returns raw bytes.
 *
 * Exported for offline unit tests; production callers go through
 * `processBatches()` above.
 */
export async function processSingleBatch(batchId: string): Promise<void> {
  const status = await retrieveBatch(batchId);

  if (status.state === "processing") {
    log.debug({ batchId, rawState: status.rawState }, "Batch still processing");
    return;
  }

  if (status.state === "failed") {
    // Mark all rows in this batch as failed + resume each pipeline so the
    // graceful-skip path kicks in. Resume worker stamps no actual-cost log
    // on the failure path (the article got nothing).
    log.warn({ batchId, rawState: status.rawState }, "Batch failed — marking rows + resuming");
    const failedRows = await db
      .update(imageBatchRequests)
      .set({
        status: "failed",
        errorMessage: `Gemini batch terminal state: ${status.rawState}`,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(imageBatchRequests.geminiBatchId, batchId))
      .returning();
    // Stamp plan completion timestamp.
    await db
      .update(weeklyPlans)
      .set({ imageBatchCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(weeklyPlans.imageBatchId, batchId));
    for (const row of failedRows) {
      await resumeImageBatchPipeline(row).catch((err) => {
        log.error({ err, rowId: row.id }, "resumeImageBatchPipeline threw");
      });
    }
    return;
  }

  // Succeeded — fetch results, upload each to R2, write back per-row.
  log.info({ batchId }, "Batch succeeded — fetching results");
  const results = await fetchBatchResults(batchId);
  if (results.length === 0) {
    log.warn({ batchId }, "Batch succeeded but no results returned — skipping");
    return;
  }

  // Update per-row by gemini_custom_id correlation.
  for (const result of results) {
    // Read the row first so we have projectId + storagePrefix + cost-math
    // inputs available for both the success and failure paths.
    const [row] = await db
      .select()
      .from(imageBatchRequests)
      .where(
        and(
          eq(imageBatchRequests.geminiBatchId, batchId),
          eq(imageBatchRequests.geminiCustomId, result.customId)
        )
      )
      .limit(1);
    if (!row) {
      log.warn({ batchId, customId: result.customId }, "No row matched batch+customId — skipping");
      continue;
    }

    // Spec 64.15 Phase A: route raw Gemini bytes through the WebP adapter so
    // batch heroes get the same magic-byte sniff + sharp conversion + forensic
    // original backup as the sync path. The adapter handles the R2 upload —
    // we just pass projectId + storagePrefix from the row and capture the keys.
    let responseBody: ImageBatchResponseBody;

    if (result.status === "succeeded") {
      try {
        const converted = await convertImageToWebp({
          projectId: row.projectId,
          bytes: result.imageBytes,
          contentType: result.contentTypeHint,
          storagePrefix: row.requestBody.storagePrefix,
        });
        responseBody = {
          r2Key: converted.webpKey,
          publicUrl: converted.webpUrl,
          originalR2Key: converted.originalKey,
          costEur: 0, // populated below
          seed: result.seed,
        };
      } catch (err) {
        // Conversion-or-storage failure on a Gemini-side success is rare but
        // not impossible (sharp throws on corrupt bytes, R2 timeout, etc.).
        // Flip to the failure branch so HeroImageStep's graceful-skip kicks
        // in rather than leaving the row stuck with an incomplete responseBody.
        log.error(
          { err, batchId, customId: result.customId, rowId: row.id },
          "image-batch: convertImageToWebp threw — marking row failed"
        );
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(imageBatchRequests)
          .set({
            status: "failed",
            responseBody: {
              r2Key: "",
              publicUrl: "",
              originalR2Key: null,
              costEur: 0,
              seed: null,
              error: `image-webp conversion failed: ${message}`,
            },
            errorMessage: `image-webp conversion failed: ${message}`,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(imageBatchRequests.id, row.id));
        const [updatedFailed] = await db
          .select()
          .from(imageBatchRequests)
          .where(eq(imageBatchRequests.id, row.id))
          .limit(1);
        if (updatedFailed) {
          await resumeImageBatchPipeline(updatedFailed).catch((resumeErr) => {
            log.error({ err: resumeErr, rowId: row.id }, "resumeImageBatchPipeline threw");
          });
        }
        continue;
      }
    } else {
      responseBody = {
        r2Key: "",
        publicUrl: "",
        originalR2Key: null,
        costEur: 0,
        seed: null,
        error: result.error,
      };
    }

    if (result.status === "succeeded") {
      const costEur = nanoBananaImageCostEur({
        model: row.requestBody.model,
        resolution: row.requestBody.resolution,
        count: 1,
        mode: "batch",
      });
      responseBody.costEur = costEur;

      await db
        .update(imageBatchRequests)
        .set({
          status: "completed",
          responseBody,
          costEur: costEur.toFixed(4),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(imageBatchRequests.id, row.id));

      // Actual-cost log (stage='actual'). Same operation as HeroImageStep's
      // resume branch would write — keeping the worker as the authoritative
      // logger so the cost lands even if the pipeline never actually resumes
      // (e.g. project deleted mid-batch).
      await db.insert(costLogs).values({
        projectId: row.projectId,
        service: "google-gemini",
        operation: COST_OPS.HERO_IMAGE_BATCH_RESULT,
        costEur: costEur.toFixed(6),
        ...(row.pipelineRunId !== null ? { pipelineRunId: row.pipelineRunId } : {}),
        metadata: {
          stage: "actual",
          provider: row.requestBody.model,
          resolution: row.requestBody.resolution,
          imageBatchRequestId: row.id,
          weeklyPlanId: row.weeklyPlanId,
          batchId,
        },
      });
    } else {
      await db
        .update(imageBatchRequests)
        .set({
          status: "failed",
          responseBody,
          errorMessage: result.error,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(imageBatchRequests.id, row.id));
    }

    // Resume the pipeline — re-load with the just-written response_body so
    // the resume helper hands a fresh row.
    const [updated] = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.id, row.id))
      .limit(1);
    if (updated) {
      await resumeImageBatchPipeline(updated).catch((err) => {
        log.error({ err, rowId: row.id }, "resumeImageBatchPipeline threw");
      });
    }
  }

  // Stamp plan completion timestamp once the last in-flight row for this
  // batch settles. Idempotent: only fires when all rows are terminal.
  const stillPending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(imageBatchRequests)
    .where(
      and(
        eq(imageBatchRequests.geminiBatchId, batchId),
        inArray(imageBatchRequests.status, ["submitted", "pending"])
      )
    );
  const pendingCount = stillPending[0]?.count ?? 0;
  if (pendingCount === 0) {
    await db
      .update(weeklyPlans)
      .set({ imageBatchCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(weeklyPlans.imageBatchId, batchId), isNull(weeklyPlans.imageBatchCompletedAt)));
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

export function startImageBatchProcessorWorker(): Worker {
  const queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  _queue = queue;

  // Submit cadence: every 2 min with deterministic per-job id so multiple
  // worker restarts coalesce. The 90-second age buffer is enforced INSIDE
  // submitPendingBatches() — the cron just wakes up.
  void queue.add(SUBMIT_JOB, {}, { repeat: { pattern: "*/2 * * * *" }, jobId: SUBMIT_JOB });
  void queue.add(PROCESS_JOB, {}, { repeat: { pattern: "0 */1 * * *" }, jobId: PROCESS_JOB });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === SUBMIT_JOB) {
        await submitPendingBatches();
      } else if (job.name === PROCESS_JOB) {
        await processBatches();
      }
    },
    { connection: getConnection(), concurrency: 1 }
  );

  worker.on("ready", () => log.info("Image-batch processor worker started"));
  worker.on("completed", (job) => log.debug({ jobName: job.name }, "image-batch job done"));
  worker.on("failed", (job, err) =>
    log.error({ jobName: job?.name, err }, "image-batch job failed")
  );

  _worker = worker;
  return worker;
}

export async function closeImageBatchProcessorInfrastructure(): Promise<void> {
  if (_worker) await _worker.close();
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
