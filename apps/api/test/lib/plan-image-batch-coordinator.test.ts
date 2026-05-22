// Spec 64.7: Plan-Image-Batch coordinator tests.
//
// Two layers:
//   - Pure helper buildBatchRequestPayloads — exercised offline (no DB, no
//     network) for transformation correctness + malformed-row resilience.
//   - submitPlanImageBatch — DB integration test that creates a plan with
//     pending rows, mocks the Gemini createImageBatch call, and asserts:
//       1. plan.image_batch_id is stamped after submit
//       2. all pending rows flip to status='submitted'
//       3. re-running on an already-submitted plan is a no-op
//       4. empty-pending plan returns no_pending without calling Gemini
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createImageBatchMock = mock(async (_input: unknown) => ({
  batchName: "batches/test-batch-001",
  requestCount: 2,
}));
mock.module("@marketing-auto/adapter-nano-banana", () => ({
  createImageBatch: createImageBatchMock,
}));

const {
  db,
  eq,
  imageBatchRequests,
  projects,
  weeklyPlans,
} = await import("@marketing-auto/db");
type WeeklyPlanSnapshot = typeof weeklyPlans.$inferInsert["inputSnapshot"];
const { buildBatchRequestPayloads, submitPlanImageBatch } = await import(
  "../../src/lib/plan-image-batch-coordinator.ts"
);

// ─── Fixture seed ─────────────────────────────────────────────────────────────

let projectId: string;
let planId: string;

beforeAll(async () => {
  projectId = crypto.randomUUID();
  await db.insert(projects).values({
    id: projectId,
    slug: `plan-batch-coord-${projectId.slice(0, 8)}`,
    name: "Coordinator test",
    industry: "ai_education",
    pipelineTemplate: "educational",
  });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  // Clear leftover plan + image_batch_requests rows from prior tests.
  await db.delete(imageBatchRequests).where(eq(imageBatchRequests.projectId, projectId));
  await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));

  planId = crypto.randomUUID();
  // Minimal valid input snapshot — cast through unknown since the test path
  // doesn't read most of these fields.
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
    status: "approved",
    estimatedCostEur: "0",
    inputSnapshot: fixtureSnapshot as unknown as WeeklyPlanSnapshot,
  });

  createImageBatchMock.mockClear();
});

async function insertPending(opts?: {
  count?: number;
  model?: "nano-banana-2" | "nano-banana-pro";
}): Promise<string[]> {
  const count = opts?.count ?? 2;
  const model = opts?.model ?? "nano-banana-2";
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    await db.insert(imageBatchRequests).values({
      id,
      projectId,
      weeklyPlanId: planId,
      pipelineRunId: crypto.randomUUID(),
      geminiCustomId: `img-${id}`,
      status: "pending",
      requestBody: {
        prompt: `Test prompt ${i}`,
        model,
        resolution: "1k",
        aspectRatio: "16:9",
        seed: 1000 + i,
        outputFormat: "webp",
        storagePrefix: "test/articles/hero",
      },
      estimatedCostEur: "0.0308",
    });
    ids.push(id);
  }
  return ids;
}

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe("buildBatchRequestPayloads (pure)", () => {
  it("maps rows 1:1 when all request_body fields are present", () => {
    const rows = [
      {
        id: "r1",
        geminiCustomId: "img-1",
        requestBody: {
          prompt: "A",
          model: "nano-banana-2" as const,
          resolution: "1k" as const,
          aspectRatio: "16:9",
          seed: 42,
          outputFormat: "webp" as const,
          storagePrefix: "x/h",
        },
      },
    ];
    const { ok, skipped } = buildBatchRequestPayloads(rows);
    expect(skipped).toEqual([]);
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({
      customId: "img-1",
      prompt: "A",
      resolution: "1k",
      aspectRatio: "16:9",
      seed: 42,
      outputFormat: "webp",
      storagePrefix: "x/h",
    });
  });

  it("drops rows with malformed request_body and reports them", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed for the test
    const rows: any[] = [
      {
        id: "r-good",
        geminiCustomId: "img-good",
        requestBody: {
          prompt: "A",
          model: "nano-banana-2",
          resolution: "1k",
          aspectRatio: "16:9",
          seed: 1,
          outputFormat: "webp",
          storagePrefix: "x/h",
        },
      },
      { id: "r-missing-prompt", geminiCustomId: "img-bad-1", requestBody: { model: "nano-banana-2" } },
      { id: "r-null-body", geminiCustomId: "img-bad-2", requestBody: null },
    ];
    const { ok, skipped } = buildBatchRequestPayloads(rows);
    expect(ok).toHaveLength(1);
    expect(ok[0]!.customId).toBe("img-good");
    expect(skipped).toEqual(["r-missing-prompt", "r-null-body"]);
  });
});

// ─── DB integration tests ─────────────────────────────────────────────────────

describe("submitPlanImageBatch (DB integration)", () => {
  it("submits ONE batch + stamps plan.image_batch_id + flips rows to 'submitted'", async () => {
    await insertPending({ count: 3 });

    const result = await submitPlanImageBatch(planId);
    expect(result.kind).toBe("submitted");
    if (result.kind === "submitted") {
      expect(result.batchName).toBe("batches/test-batch-001");
      expect(result.imageCount).toBe(3);
    }

    // Plan stamped.
    const [plan] = await db.select().from(weeklyPlans).where(eq(weeklyPlans.id, planId));
    expect(plan?.imageBatchId).toBe("batches/test-batch-001");
    expect(plan?.imageBatchSubmittedAt).not.toBeNull();

    // All 3 rows flipped to submitted with the batch id stamped.
    const rows = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.weeklyPlanId, planId));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe("submitted");
      expect(row.geminiBatchId).toBe("batches/test-batch-001");
      expect(row.submittedAt).not.toBeNull();
    }

    // Adapter was called exactly once.
    expect(createImageBatchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 'no_pending' + does NOT call Gemini when there are no pending rows", async () => {
    // No pending rows seeded.
    const result = await submitPlanImageBatch(planId);
    expect(result.kind).toBe("no_pending");
    expect(createImageBatchMock).not.toHaveBeenCalled();

    // Plan untouched.
    const [plan] = await db.select().from(weeklyPlans).where(eq(weeklyPlans.id, planId));
    expect(plan?.imageBatchId).toBeNull();
  });

  it("is idempotent: re-running on an already-submitted plan short-circuits to 'already_submitted'", async () => {
    await insertPending({ count: 2 });

    const first = await submitPlanImageBatch(planId);
    expect(first.kind).toBe("submitted");
    expect(createImageBatchMock).toHaveBeenCalledTimes(1);

    // Second run — plan now has image_batch_id set.
    const second = await submitPlanImageBatch(planId);
    expect(second.kind).toBe("already_submitted");
    if (second.kind === "already_submitted") {
      expect(second.existingBatchId).toBe("batches/test-batch-001");
    }
    // Adapter only called once across both runs.
    expect(createImageBatchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on mixed-model batch (out of v1 scope)", async () => {
    await insertPending({ count: 1, model: "nano-banana-2" });
    await insertPending({ count: 1, model: "nano-banana-pro" });

    expect(submitPlanImageBatch(planId)).rejects.toThrow(/mixes 2 models/);
  });

  it("returns 'no_pending' for a plan id that doesn't exist", async () => {
    const ghostId = crypto.randomUUID();
    const result = await submitPlanImageBatch(ghostId);
    expect(result.kind).toBe("no_pending");
    expect(createImageBatchMock).not.toHaveBeenCalled();
  });
});
