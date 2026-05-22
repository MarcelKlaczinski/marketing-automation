// Spec 64.7: Dual-mode hero-image client (sync + batch) for Google Gemini.
// Pattern 118 mirror of batch-llm-client.ts: returns batchPending signal
// instead of throwing on suspension.
//
// Sync mode is handled directly by HeroImageStep calling nanoBanana.generateImage().
// This module owns ONLY the batch-enqueue side: write a pending image_batch_requests
// row + log estimated cost, then return the imageBatchPending signal so the runner
// suspends the pipeline.

import { COST_OPS, estimateHeroImageCost } from "@marketing-auto/core/cost";
import {
  costLogs,
  db,
  imageBatchRequests,
  type ImageBatchRequestBody,
  type NewImageBatchRequest,
} from "@marketing-auto/db";
import type { NanoBananaModel, NanoBananaResolution } from "@marketing-auto/adapter-nano-banana";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:image-batch-client");

/**
 * Inputs the HeroImageStep passes when suspending in batch mode. All values
 * are frozen into the image_batch_requests row so the plan-coordinator can
 * rebuild the Gemini request later without re-reading the article outline.
 */
export type EnqueueImageBatchInput = {
  projectId: string;
  pipelineRunId: string;
  /**
   * NULL for ad-hoc / standalone runs that are NOT part of a planner plan.
   * Required for the plan-coordinator path — the coordinator queries by this id.
   */
  weeklyPlanId: string | null;
  articleId: string;

  // Generation parameters (frozen into requestBody)
  prompt: string;
  model: NanoBananaModel;
  resolution: NanoBananaResolution;
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "4:5";
  seed: number;
  outputFormat: "webp" | "png" | "jpeg";
  storagePrefix: string;
};

/**
 * Spec 64.7: Pattern 118 batch-suspend signal for hero-image step. Sibling of
 * `{ batchPending: true, batchRequestId }` from batch-llm-client. Returned from
 * HeroImageStep when `ctx.llmMode === "batch"` so the runner writes a
 * `kind: "image_batch"` checkpoint and suspends without throwing.
 */
export type ImageBatchPendingSignal = {
  imageBatchPending: true;
  imageBatchRequestId: string;
};

/**
 * Enqueue a pending image_batch_requests row + log the estimated cost.
 *
 * The plan-coordinator (`apps/api/src/lib/plan-image-batch-coordinator.ts`)
 * picks up all `status='pending'` rows for an approved plan and submits ONE
 * Gemini batch with all of them. Until then the row sits at `status='pending'`
 * with `gemini_batch_id=NULL` and the pipeline stays suspended.
 */
export async function enqueueImageBatch(
  input: EnqueueImageBatchInput,
): Promise<ImageBatchPendingSignal> {
  // Pattern 119: custom_id = `img-{pipelineRunId}` (separator '-' satisfies
  // Gemini's `^[a-zA-Z0-9_-]{1,64}$` constraint just like Anthropic).
  const customId = `img-${input.pipelineRunId}`;

  // Real-world per-call cost estimate (project-aware, mode='batch' → 50% off).
  // Stamped on both the image_batch_requests row AND the cost_logs:submit row
  // so the dashboard / budget gate sees the estimate immediately.
  const estimatedCostEur = estimateHeroImageCost(input.model, input.resolution, "batch");

  const requestBody: ImageBatchRequestBody = {
    prompt: input.prompt,
    model: input.model,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    seed: input.seed,
    outputFormat: input.outputFormat,
    storagePrefix: input.storagePrefix,
  };

  const insertValues: NewImageBatchRequest = {
    projectId: input.projectId,
    pipelineRunId: input.pipelineRunId,
    weeklyPlanId: input.weeklyPlanId,
    geminiCustomId: customId,
    status: "pending",
    requestBody,
    estimatedCostEur: estimatedCostEur.toFixed(4),
  };

  const [row] = await db
    .insert(imageBatchRequests)
    .values(insertValues)
    .returning({ id: imageBatchRequests.id });
  if (!row) {
    throw new Error("enqueueImageBatch: insert returned no row");
  }

  // Estimate log — stage='estimate' so the UI can filter actual vs estimated
  // when surfacing per-plan cost diffs. service='google-gemini' for sync AND
  // batch (operation discriminator, mirroring Anthropic batch convention).
  await db.insert(costLogs).values({
    projectId: input.projectId,
    service: "google-gemini",
    operation: COST_OPS.HERO_IMAGE_BATCH_SUBMIT,
    costEur: estimatedCostEur.toFixed(6),
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    metadata: {
      stage: "estimate",
      provider: input.model,
      resolution: input.resolution,
      imageBatchRequestId: row.id,
      weeklyPlanId: input.weeklyPlanId,
    },
  });

  log.info(
    {
      imageBatchRequestId: row.id,
      pipelineRunId: input.pipelineRunId,
      weeklyPlanId: input.weeklyPlanId,
      customId,
      estimatedCostEur,
    },
    "Image-batch request enqueued (pending plan-coordinator submit)",
  );

  return { imageBatchPending: true, imageBatchRequestId: row.id };
}
