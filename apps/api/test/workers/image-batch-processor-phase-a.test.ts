// Spec 64.15 Phase A: image-batch-processor worker routes raw Gemini bytes
// through @marketing-auto/adapter-image-webp BEFORE storing to R2, so
// batch-generated heroes get the same magic-byte sniff + WebP conversion +
// forensic original backup as the sync path (Pattern 119).
//
// Two cases:
//   1. PNG bytes from Gemini → convertImageToWebp called with the row's
//      projectId + storagePrefix; response_body.originalR2Key populated.
//   2. WebP bytes (fast path) → originalR2Key is null (no forensic copy).
//
// Both stay offline:
//   - adapter `fetchBatchResults` + `retrieveBatch` mocked
//   - adapter-image-webp `convertImageToWebp` mocked (no sharp dep needed)
//   - resume helper mocked (no pipeline_runs lookup needed)
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ─── Module mocks (set before importing the worker) ───────────────────────────

const fetchBatchResultsMock = mock(async (_batchId: string) => [] as unknown[]);
const retrieveBatchMock = mock(async (_batchId: string) => ({
  state: "succeeded" as const,
  rawState: "JOB_STATE_SUCCEEDED",
}));
// `mock.module` replaces the whole module — include every export consumed
// downstream (worker imports just fetchBatchResults + retrieveBatch, but the
// transitively-loaded plan-image-batch-coordinator imports createImageBatch).
const createImageBatchMock = mock(async (_input: unknown) => ({
  batchName: "batches/mock",
  requestCount: 0,
}));
mock.module("@marketing-auto/adapter-nano-banana", () => ({
  fetchBatchResults: fetchBatchResultsMock,
  retrieveBatch: retrieveBatchMock,
  createImageBatch: createImageBatchMock,
}));

type WebpResult = {
  webpKey: string;
  webpUrl: string;
  webpBytes: number;
  originalKey: string | null;
  originalUrl: string | null;
  originalBytes: number | null;
  alreadyWebp: boolean;
};
const convertImageToWebpMock = mock(
  async (_input: {
    projectId: string;
    bytes: Uint8Array;
    storagePrefix: string;
  }): Promise<WebpResult> => ({
    webpKey: "toolwiki/articles/hero/converted.webp",
    webpUrl: "https://cdn.test/converted.webp",
    webpBytes: 12345,
    originalKey: "toolwiki/articles/hero/originals/converted.png",
    originalUrl: "https://cdn.test/originals/converted.png",
    originalBytes: 23456,
    alreadyWebp: false,
  }),
);
mock.module("@marketing-auto/adapter-image-webp", () => ({
  convertImageToWebp: convertImageToWebpMock,
}));

// Resume is mocked: the test asserts the row state AFTER processSingleBatch,
// not the full re-enqueue flow (covered by image-batch-resume.test.ts).
const resumeImageBatchPipelineMock = mock(async (_row: unknown) => {});
mock.module("@marketing-auto/pipelines/image-batch-resume", () => ({
  resumeImageBatchPipeline: resumeImageBatchPipelineMock,
}));

const {
  db,
  eq,
  imageBatchRequests,
  pipelineRuns,
  plannedItems,
  projects,
  weeklyPlans,
} = await import("@marketing-auto/db");
const { processSingleBatch } = await import(
  "../../src/workers/image-batch-processor.worker.ts"
);

// ─── Fixture seed ─────────────────────────────────────────────────────────────

let projectId: string;
let planId: string;
let pipelineRunId: string;
const batchId = "batches/phase-a-test-001";

beforeAll(async () => {
  projectId = crypto.randomUUID();
  await db.insert(projects).values({
    id: projectId,
    slug: `phase-a-batch-${projectId.slice(0, 8)}`,
    name: "Phase A test",
    industry: "ai_education",
    pipelineTemplate: "educational",
  });
});

afterAll(async () => {
  // Cascade order: image_batch_requests → planned_items → weekly_plans →
  // pipeline_runs → projects. CASCADE on project_id handles most of it but
  // pipeline_runs lives outside that cascade.
  await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  await db.delete(imageBatchRequests).where(eq(imageBatchRequests.projectId, projectId));
  await db.delete(plannedItems).where(eq(plannedItems.projectId, projectId));
  await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
  await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));

  planId = crypto.randomUUID();
  pipelineRunId = crypto.randomUUID();

  // Minimal weekly_plans row — most fields default OK.
  const fixtureSnapshot = {
    goals: [],
    config: {
      weeklyBudgetEur: 100,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 0,
      maxOveragePerSignal: 0,
      signalMaxAgeHours: 168,
      excludedPipelines: [],
      llmMode: "batch",
      diversityThreshold: 0.5,
      diversityMalusWeight: 0.5,
      planDiversityLookbackWeeks: 3,
      imageGenerationProvider: "nano-banana-2",
      imageGenerationResolution: "1k",
    },
    signalRefreshResult: {
      perSourceCounts: {},
      totalSignalsCollected: 0,
      ranAt: new Date().toISOString(),
    },
    topicBriefSnapshot: [],
    signalTopN: [],
    triggeredAt: new Date().toISOString(),
  };
  await db.insert(weeklyPlans).values({
    id: planId,
    projectId,
    year: 2026,
    isoWeek: 22,
    weekStartDate: new Date("2026-05-25"),
    weekEndDate: new Date("2026-05-31"),
    status: "running",
    estimatedCostEur: "0",
    imageBatchId: batchId,
    inputSnapshot: fixtureSnapshot as never,
  });

  await db.insert(pipelineRuns).values({
    id: pipelineRunId,
    projectId,
    pipelineName: "article:blog",
    status: "batch_pending",
    input: {},
  });

  fetchBatchResultsMock.mockClear();
  retrieveBatchMock.mockClear();
  convertImageToWebpMock.mockClear();
  resumeImageBatchPipelineMock.mockClear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("processSingleBatch (Spec 64.15 Phase A — convertImageToWebp routing)", () => {
  it("routes Gemini bytes through convertImageToWebp and persists originalR2Key", async () => {
    const customId = `img-${pipelineRunId}`;
    const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic

    // Seed pending row matching the batch.
    await db.insert(imageBatchRequests).values({
      projectId,
      weeklyPlanId: planId,
      pipelineRunId,
      geminiBatchId: batchId,
      geminiCustomId: customId,
      status: "submitted",
      requestBody: {
        model: "nano-banana-2",
        prompt: "test prompt",
        aspectRatio: "16:9",
        resolution: "1k",
        seed: 42,
        outputFormat: "webp",
        storagePrefix: "toolwiki/articles/hero",
      },
      estimatedCostEur: "0.031",
    });

    fetchBatchResultsMock.mockImplementationOnce(async () => [
      {
        customId,
        status: "succeeded",
        imageBytes: fakeBytes,
        contentTypeHint: "image/png",
        seed: 42,
      },
    ]);

    await processSingleBatch(batchId);

    // 1. Adapter routed raw bytes through convertImageToWebp.
    expect(convertImageToWebpMock).toHaveBeenCalledTimes(1);
    const [convertCall] = convertImageToWebpMock.mock.calls;
    const convertArg = convertCall![0] as {
      projectId: string;
      bytes: Uint8Array;
      contentType: string;
      storagePrefix: string;
    };
    expect(convertArg.projectId).toBe(projectId);
    expect(convertArg.bytes).toBe(fakeBytes);
    expect(convertArg.contentType).toBe("image/png");
    expect(convertArg.storagePrefix).toBe("toolwiki/articles/hero");

    // 2. Row completed with both r2Key + originalR2Key from the webp adapter.
    const [row] = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.geminiCustomId, customId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
    expect(row!.responseBody?.r2Key).toBe("toolwiki/articles/hero/converted.webp");
    expect(row!.responseBody?.originalR2Key).toBe(
      "toolwiki/articles/hero/originals/converted.png",
    );

    // 3. Resume was called.
    expect(resumeImageBatchPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("WebP-fast-path: convertImageToWebp returns null originalKey → responseBody.originalR2Key is null", async () => {
    const customId = `img-${pipelineRunId}`;
    const fakeWebpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF magic

    await db.insert(imageBatchRequests).values({
      projectId,
      weeklyPlanId: planId,
      pipelineRunId,
      geminiBatchId: batchId,
      geminiCustomId: customId,
      status: "submitted",
      requestBody: {
        model: "nano-banana-2",
        prompt: "test prompt",
        aspectRatio: "16:9",
        resolution: "1k",
        seed: 42,
        outputFormat: "webp",
        storagePrefix: "toolwiki/articles/hero",
      },
      estimatedCostEur: "0.031",
    });

    // Fast-path: convertImageToWebp's fast branch returns originalKey=null.
    convertImageToWebpMock.mockImplementationOnce(async () => ({
      webpKey: "toolwiki/articles/hero/fast.webp",
      webpUrl: "https://cdn.test/fast.webp",
      webpBytes: 5000,
      originalKey: null,
      originalUrl: null,
      originalBytes: null,
      alreadyWebp: true,
    }));

    fetchBatchResultsMock.mockImplementationOnce(async () => [
      {
        customId,
        status: "succeeded",
        imageBytes: fakeWebpBytes,
        contentTypeHint: "image/webp",
        seed: 42,
      },
    ]);

    await processSingleBatch(batchId);

    const [row] = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.geminiCustomId, customId))
      .limit(1);
    expect(row!.status).toBe("completed");
    expect(row!.responseBody?.r2Key).toBe("toolwiki/articles/hero/fast.webp");
    // Fast path: null because input was already WebP, no forensic copy needed.
    expect(row!.responseBody?.originalR2Key).toBeNull();
  });
});
