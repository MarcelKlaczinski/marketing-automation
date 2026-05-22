// Spec 64.7: resumeImageBatchPipeline direct tests.
//
// Exercises the DB-mutation paths the HeroImageStep batch-resume tests don't
// reach: kind-discriminator guard, supersedeOldSubstep call, queued-status
// flip, image_batch_requests → resume_enqueued terminal flip, defensive bail
// when the pipeline_run is no longer batch_pending.
//
// All tests stay offline — `enqueuePipeline` from the engine queue is mocked
// at module level to avoid a real BullMQ enqueue.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ImageBatchRequest,
  ImageBatchResponseBody,
  SuspensionCheckpoint,
} from "@marketing-auto/db";

// ─── Module-level mocks ───────────────────────────────────────────────────────

const enqueuePipelineMock = mock(async () => ({ jobId: "test-job" }));
mock.module("../../src/engine/queue.ts", () => ({
  enqueuePipeline: enqueuePipelineMock,
}));

const {
  articles,
  db,
  eq,
  imageBatchRequests,
  pipelineRuns,
  projects,
  weeklyPlans,
} = await import("@marketing-auto/db");
const { resumeImageBatchPipeline } = await import("../../src/engine/image-batch-resume.ts");

// ─── Fixture seed ─────────────────────────────────────────────────────────────

let projectId: string;
let articleId: string;
let runId: string;
let weeklyPlanId: string;
let batchRequestId: string;

beforeAll(async () => {
  projectId = crypto.randomUUID();
  articleId = crypto.randomUUID();

  await db.insert(projects).values({
    id: projectId,
    slug: `imgbres-${projectId.slice(0, 8)}`,
    name: "image-batch-resume test",
    industry: "ai_education",
    pipelineTemplate: "educational",
  });
  await db.insert(articles).values({
    id: articleId,
    projectId,
    slug: `art-${articleId.slice(0, 8)}`,
    title: "T",
  });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  enqueuePipelineMock.mockClear();

  // Clean residue (FK cascade order).
  await db.delete(imageBatchRequests).where(eq(imageBatchRequests.projectId, projectId));
  await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
  await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));

  runId = crypto.randomUUID();
  weeklyPlanId = crypto.randomUUID();
  batchRequestId = crypto.randomUUID();
});

// Helper to seed a typical "suspended pipeline + completed image batch row" state.
async function seedSuspendedRun(opts?: {
  runStatus?: "batch_pending" | "queued" | "completed";
  batchStatus?: "pending" | "submitted" | "completed" | "failed" | "resume_enqueued";
  checkpointKind?: "batch" | "image_batch" | "step_pause";
  responseBody?: ImageBatchResponseBody | null;
  errorMessage?: string;
}): Promise<{ row: ImageBatchRequest }> {
  const runStatus = opts?.runStatus ?? "batch_pending";
  const batchStatus = opts?.batchStatus ?? "completed";
  const kind = opts?.checkpointKind ?? "image_batch";
  const responseBody =
    opts?.responseBody !== undefined
      ? opts.responseBody
      : ({
          r2Key: "test/hero.webp",
          publicUrl: "https://cdn.test/hero.webp",
          costEur: 0.031,
          seed: 42,
        } satisfies ImageBatchResponseBody);

  // Build a checkpoint matching the requested discriminator. For non-image_batch
  // kinds we still set imageBatchRequestId so the helper's read doesn't crash —
  // the kind-guard should bail before any field access matters.
  const checkpoint: SuspensionCheckpoint =
    kind === "image_batch"
      ? {
          kind: "image_batch",
          stepKey: "hero-image",
          imageBatchRequestId: batchRequestId,
          accumulatedOutput: { research: { ok: true } },
        }
      : kind === "batch"
        ? {
            kind: "batch",
            stepKey: "outline",
            batchRequestId,
            accumulatedOutput: {},
          }
        : {
            kind: "step_pause",
            stepKey: "outline",
            stepPauseId: crypto.randomUUID(),
            accumulatedOutput: {},
          };

  await db.insert(pipelineRuns).values({
    id: runId,
    projectId,
    pipelineName: "article:blog",
    status: runStatus,
    input: { articleId, projectId },
    suspensionCheckpoint: checkpoint as unknown as Record<string, unknown>,
  });

  await db.insert(weeklyPlans).values({
    id: weeklyPlanId,
    projectId,
    year: 2026,
    isoWeek: 22,
    weekStartDate: new Date("2026-05-25"),
    weekEndDate: new Date("2026-05-31"),
    status: "approved",
    estimatedCostEur: "0",
    // Test-fixture minimal snapshot — cast through unknown since this test
    // doesn't read any snapshot field.
    inputSnapshot: {} as unknown as typeof weeklyPlans.$inferInsert["inputSnapshot"],
  });

  await db.insert(imageBatchRequests).values({
    id: batchRequestId,
    projectId,
    weeklyPlanId,
    pipelineRunId: runId,
    geminiBatchId: "batches/test-001",
    geminiCustomId: `img-${runId}`,
    status: batchStatus,
    requestBody: {
      prompt: "x",
      model: "nano-banana-2",
      resolution: "1k",
      aspectRatio: "16:9",
      seed: 42,
      outputFormat: "webp",
      storagePrefix: "x/h",
    },
    responseBody,
    estimatedCostEur: "0.0308",
    costEur: "0.0308",
    ...(opts?.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
  });

  const [row] = await db
    .select()
    .from(imageBatchRequests)
    .where(eq(imageBatchRequests.id, batchRequestId));
  return { row: row! };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resumeImageBatchPipeline (Spec 64.7)", () => {
  it("re-enqueues pipeline with batchResult on completion + clears suspension_checkpoint", async () => {
    const { row } = await seedSuspendedRun();

    await resumeImageBatchPipeline(row);

    // enqueuePipeline was called with the batch result JSON-encoded.
    expect(enqueuePipelineMock).toHaveBeenCalledTimes(1);
    const calls = enqueuePipelineMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const callArg = calls[0]![0] as unknown as {
      pipelineName: string;
      projectId: string;
      preRunId: string;
      resumeFromStep: string;
      batchResult: { stepKey: string; content: string };
      priorOutput: Record<string, unknown>;
    };
    expect(callArg.pipelineName).toBe("article:blog");
    expect(callArg.preRunId).toBe(runId);
    expect(callArg.resumeFromStep).toBe("hero-image");
    expect(callArg.batchResult.stepKey).toBe("hero-image");
    const decoded = JSON.parse(callArg.batchResult.content) as ImageBatchResponseBody;
    expect(decoded.r2Key).toBe("test/hero.webp");
    expect(decoded.costEur).toBeCloseTo(0.031, 5);
    expect(callArg.priorOutput).toEqual({ research: { ok: true } });

    // suspension_checkpoint cleared + pipeline_runs flipped back to queued.
    const [updatedRun] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, runId));
    expect(updatedRun!.status).toBe("queued");
    expect(updatedRun!.suspensionCheckpoint).toBeNull();

    // image_batch_requests flipped to terminal resume_enqueued.
    const [updatedBatch] = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.id, batchRequestId));
    expect(updatedBatch!.status).toBe("resume_enqueued");
  });

  it("skips when pipeline_run is no longer batch_pending (already processed)", async () => {
    // Simulate a run that landed already (e.g. another worker raced ahead).
    const { row } = await seedSuspendedRun({ runStatus: "completed" });

    await resumeImageBatchPipeline(row);

    expect(enqueuePipelineMock).not.toHaveBeenCalled();

    // image_batch_requests stays "completed" — we did NOT flip it to
    // resume_enqueued because no resume actually happened.
    const [batch] = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.id, batchRequestId));
    expect(batch!.status).toBe("completed");
  });

  it("refuses to resume when checkpoint kind is 'batch' (defensive — Anthropic LLM batch)", async () => {
    const { row } = await seedSuspendedRun({ checkpointKind: "batch" });

    await resumeImageBatchPipeline(row);

    expect(enqueuePipelineMock).not.toHaveBeenCalled();
    // Run stays batch_pending; checkpoint preserved for the Anthropic resumer.
    const [updatedRun] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, runId));
    expect(updatedRun!.status).toBe("batch_pending");
    expect(updatedRun!.suspensionCheckpoint).not.toBeNull();
  });

  it("re-enqueues with error payload when row.status='failed' (graceful-skip path)", async () => {
    const { row } = await seedSuspendedRun({
      batchStatus: "failed",
      responseBody: null,
      errorMessage: "Gemini batch terminal state: JOB_STATE_CANCELLED",
    });

    await resumeImageBatchPipeline(row);

    // Resume still happens — HeroImageStep's resume branch reads the error
    // field and falls through to its graceful-skip return (empty hero).
    expect(enqueuePipelineMock).toHaveBeenCalledTimes(1);
    const calls = enqueuePipelineMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const callArg = calls[0]![0] as unknown as {
      batchResult: { stepKey: string; content: string };
    };
    const decoded = JSON.parse(callArg.batchResult.content) as ImageBatchResponseBody;
    expect(decoded.error).toContain("Gemini batch terminal state");
    expect(decoded.r2Key).toBe("");
    expect(decoded.publicUrl).toBe("");
  });
});
