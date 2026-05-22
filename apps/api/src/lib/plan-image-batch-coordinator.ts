// Spec 64.7: Plan-level coordinator for the Google Gemini Image Batch API.
//
// Triggered by:
//   - The image-batch-processor.worker.ts submit-pending cron (every 2 min):
//     finds approved plans with N≥1 pending image_batch_requests rows AND no
//     submitted batch yet, calls submitPlanImageBatch(planId) for each.
//
// Memory D130: this file owns the mutations; the worker is a thin wrapper.
//
// Per-plan idempotency: a plan with `image_batch_id` already set is skipped
// (one batch per plan). This is the natural state machine — re-running the
// cron after submit is a no-op, not a re-submit.

import {
  createImageBatch,
  type BatchImageRequest,
} from "@marketing-auto/adapter-nano-banana";
import {
  and,
  db,
  eq,
  imageBatchRequests,
  isNull,
  type ImageBatchRequestBody,
  weeklyPlans,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("api:plan-image-batch-coordinator");

export type SubmitPlanImageBatchResult =
  | { kind: "submitted"; batchName: string; imageCount: number }
  | { kind: "no_pending"; reason: "no_pending_rows" }
  | { kind: "already_submitted"; existingBatchId: string };

/**
 * Pure helper: map persisted image_batch_requests rows to the adapter's
 * `BatchImageRequest[]` shape. Exported for unit tests so the transformation
 * can be exercised without a DB / Gemini round-trip.
 *
 * Drops rows with malformed request_body (the SELECT is the source of truth;
 * a missing field means an earlier write was corrupted). The coordinator
 * logs + skips those rows rather than failing the whole batch.
 */
export function buildBatchRequestPayloads(
  rows: Array<{ id: string; geminiCustomId: string; requestBody: ImageBatchRequestBody }>,
): { ok: BatchImageRequest[]; skipped: string[] } {
  const ok: BatchImageRequest[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const body = row.requestBody;
    if (
      !body ||
      typeof body.prompt !== "string" ||
      typeof body.model !== "string" ||
      typeof body.resolution !== "string" ||
      typeof body.aspectRatio !== "string" ||
      typeof body.seed !== "number" ||
      typeof body.outputFormat !== "string" ||
      typeof body.storagePrefix !== "string"
    ) {
      skipped.push(row.id);
      continue;
    }
    // The aspectRatio field is typed `string` here for tolerance; the adapter
    // narrows to its union via parameter type.
    ok.push({
      customId: row.geminiCustomId,
      prompt: body.prompt,
      resolution: body.resolution as BatchImageRequest["resolution"],
      aspectRatio: body.aspectRatio as BatchImageRequest["aspectRatio"],
      seed: body.seed,
      outputFormat: body.outputFormat as BatchImageRequest["outputFormat"],
      storagePrefix: body.storagePrefix,
    });
  }
  return { ok, skipped };
}

/**
 * Submit ONE Gemini batch for an approved plan's pending hero-image requests.
 *
 * Idempotency layer 1: `weekly_plans.image_batch_id IS NOT NULL` short-circuits.
 * Idempotency layer 2: the BullMQ submit-pending cron uses a deterministic
 *   per-plan jobId so concurrent ticks dedup at the queue level.
 *
 * Splits by model — all requests in one Gemini batch must share the same model
 * (the batchGenerateContent endpoint encodes the model in the path). In
 * practice Toolwiki uses one provider per project, so this branch is rare; we
 * raise an explicit error rather than submitting two batches half-silently.
 */
export async function submitPlanImageBatch(
  planId: string,
): Promise<SubmitPlanImageBatchResult> {
  // 1. Load plan — must exist and not have an image_batch_id yet.
  const [plan] = await db
    .select()
    .from(weeklyPlans)
    .where(eq(weeklyPlans.id, planId))
    .limit(1);
  if (!plan) {
    log.warn({ planId }, "submitPlanImageBatch: plan not found — skipping");
    return { kind: "no_pending", reason: "no_pending_rows" };
  }
  if (plan.imageBatchId !== null) {
    log.debug(
      { planId, existingBatchId: plan.imageBatchId },
      "submitPlanImageBatch: plan already has an image batch — skipping",
    );
    return { kind: "already_submitted", existingBatchId: plan.imageBatchId };
  }

  // 2. Load pending rows.
  const pendingRows = await db
    .select({
      id: imageBatchRequests.id,
      geminiCustomId: imageBatchRequests.geminiCustomId,
      requestBody: imageBatchRequests.requestBody,
    })
    .from(imageBatchRequests)
    .where(
      and(
        eq(imageBatchRequests.weeklyPlanId, planId),
        eq(imageBatchRequests.status, "pending"),
      ),
    );

  if (pendingRows.length === 0) {
    log.debug({ planId }, "submitPlanImageBatch: no pending rows — skipping");
    return { kind: "no_pending", reason: "no_pending_rows" };
  }

  // 3. Group by model. Mixed-model batches must be split — the Gemini batch
  // endpoint takes one model. In practice a project's image_generation_provider
  // is fixed, so this should always be a single group.
  type Model = ImageBatchRequestBody["model"];
  const byModel = new Map<Model, typeof pendingRows>();
  for (const row of pendingRows) {
    const model: Model = row.requestBody?.model ?? "nano-banana-2";
    const bucket = byModel.get(model);
    if (bucket) bucket.push(row);
    else byModel.set(model, [row]);
  }

  if (byModel.size > 1) {
    // V1 only handles single-model batches. Surfacing as an error keeps the
    // pending rows around for human inspection rather than picking a winner.
    throw new Error(
      `submitPlanImageBatch: plan ${planId} mixes ${byModel.size} models (${[...byModel.keys()].join(",")}) — splitting per-model is a follow-up`,
    );
  }

  const [model] = [...byModel.keys()];
  const rowsForModel = byModel.get(model!)!;

  const { ok: requests, skipped } = buildBatchRequestPayloads(rowsForModel);
  if (skipped.length > 0) {
    log.warn(
      { planId, skipped },
      "submitPlanImageBatch: dropped rows with malformed request_body",
    );
  }
  if (requests.length === 0) {
    log.warn({ planId }, "submitPlanImageBatch: all pending rows malformed — skipping");
    return { kind: "no_pending", reason: "no_pending_rows" };
  }

  log.info(
    { planId, model, requestCount: requests.length },
    "submitPlanImageBatch: submitting Gemini batch",
  );

  // 4. Submit to Gemini.
  const { batchName } = await createImageBatch({
    model: model!,
    displayName: `plan-${planId.slice(0, 8)}-${Date.now()}`,
    requests,
  });

  // 5. Transactionally update both tables:
  //   - image_batch_requests: pending → submitted, populate batch_id
  //   - weekly_plans: stamp image_batch_id + image_batch_submitted_at
  // The plan-level UPDATE is the idempotency anchor — once it commits, the
  // next cron tick reads `imageBatchId !== null` and short-circuits.
  await db.transaction(async (tx) => {
    await tx
      .update(imageBatchRequests)
      .set({
        geminiBatchId: batchName,
        status: "submitted",
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(imageBatchRequests.weeklyPlanId, planId),
          eq(imageBatchRequests.status, "pending"),
        ),
      );

    await tx
      .update(weeklyPlans)
      .set({
        imageBatchId: batchName,
        imageBatchSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(weeklyPlans.id, planId), isNull(weeklyPlans.imageBatchId)));
  });

  log.info(
    { planId, batchName, imageCount: requests.length },
    "submitPlanImageBatch: batch submitted + DB updated",
  );

  return { kind: "submitted", batchName, imageCount: requests.length };
}
