// Spec 64.7: HeroImageStep batch-mode branch + batch-resume branch.
//
// These tests stay offline:
//   - adapter calls are mocked at the module level
//   - DB-backed `enqueueImageBatch` writes to the real local Postgres (same as
//     other pipeline tests). The test creates project + article + planned_item
//     + pipeline_run rows so the FK + planned_item lookup paths exercise.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ─── Module-level mocks (set BEFORE importing the step) ───────────────────────

const nanoBananaGenerateMock = mock(async () => ({
  publicUrl: "https://cdn.test/sync.webp",
  r2Key: "test/sync.webp",
  bytesStored: 100,
  contentType: "image/webp",
  seed: 42,
  durationMs: 5,
  modelSlug: "gemini-3-flash-image-preview",
}));

mock.module("@marketing-auto/adapter-nano-banana", () => ({
  generateImage: nanoBananaGenerateMock,
  // Re-export the types the step imports (need them as runtime-no-ops so
  // `import type` survives `mock.module`-induced re-evaluation).
  NANO_BANANA_MODELS: {
    "nano-banana-2": "gemini-3-flash-image-preview",
    "nano-banana-pro": "gemini-3-pro-image-preview",
  },
}));

const replicateGenerateMock = mock(async () => ({
  r2Key: "test/replicate.webp",
  publicUrl: "https://cdn.test/replicate.webp",
}));
mock.module("@marketing-auto/adapter-replicate", () => ({
  replicate: { generateImage: replicateGenerateMock },
}));

// Import AFTER mocks
const {
  articles,
  costLogs,
  db,
  eq,
  imageBatchRequests,
  pipelineRuns,
  plannedItems,
  projects,
  weeklyPlans,
} = await import("@marketing-auto/db");
const { HeroImageStep } = await import("../../src/article/steps/hero-image.ts");
const { makeMockCtx } = await import("../fixtures/mock-ctx.ts");

// ─── Fixture seed ─────────────────────────────────────────────────────────────

let projectId: string;
let projectSlug: string;
let articleId: string;
let pipelineRunId: string;
let weeklyPlanId: string;
let plannedItemId: string;

beforeAll(async () => {
  projectId = crypto.randomUUID();
  projectSlug = `hib-test-${projectId.slice(0, 8)}`;
  articleId = crypto.randomUUID();

  await db.insert(projects).values({
    id: projectId,
    slug: projectSlug,
    name: "HeroImageBatch test",
    industry: "ai_education",
    pipelineTemplate: "educational",
    imageGenerationProvider: "nano-banana-2",
    imageGenerationResolution: "1k",
  });
  await db.insert(articles).values({
    id: articleId,
    projectId,
    slug: `hib-article-${articleId.slice(0, 8)}`,
    title: "Test Article",
    locale: "de",
    outline: {
      title: "Test Article About AI Hero Generation Pipeline",
      slug: "test-article-about-ai-hero",
      metaDescription:
        "Meta description for the test article — long enough to satisfy the 80-char minimum on outline parsing.",
      introAngle:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
      sections: [
        {
          h2: "Section one heading",
          intent: "Explain the first concept clearly with enough text to pass schema.",
          keyPoints: ["First key point goes here", "Second key point goes here"],
          estimatedWords: 200,
          targetKeywords: [],
        },
        {
          h2: "Section two heading",
          intent: "Explain the second concept clearly with enough text to pass schema.",
          keyPoints: ["Third key point goes here", "Fourth key point goes here"],
          estimatedWords: 200,
          targetKeywords: [],
        },
        {
          h2: "Section three heading",
          intent: "Explain the third concept clearly with enough text to pass schema.",
          keyPoints: ["Fifth key point goes here", "Sixth key point goes here"],
          estimatedWords: 200,
          targetKeywords: [],
        },
        {
          h2: "Section four heading",
          intent: "Explain the fourth concept clearly with enough text to pass schema.",
          keyPoints: ["Seventh key point goes here", "Eighth key point goes here"],
          estimatedWords: 200,
          targetKeywords: [],
        },
      ],
      heroImagePrompt:
        "Editorial AI desk flatlay with brushed-aluminium notebook, soft warm window light, minimal composition.",
      heroImageStyle: "photorealistic",
      estimatedTotalWords: 1000,
    },
  });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  // Re-create the pipeline_run + planned_item + weekly_plan for each test so
  // the batch path can find a fresh planned_items row to query weeklyPlanId from.
  pipelineRunId = crypto.randomUUID();
  weeklyPlanId = crypto.randomUUID();
  plannedItemId = crypto.randomUUID();

  // Clean prior test residue in dependency order — the partial unique index
  // on weekly_plans(project, year, week) trips on re-insert otherwise.
  await db.delete(imageBatchRequests).where(eq(imageBatchRequests.projectId, projectId));
  await db.delete(costLogs).where(eq(costLogs.projectId, projectId));
  await db.delete(plannedItems).where(eq(plannedItems.projectId, projectId));
  await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
  await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));

  await db.insert(pipelineRuns).values({
    id: pipelineRunId,
    projectId,
    pipelineName: "article:blog",
    status: "running",
    input: { articleId },
  });

  // Minimal valid snapshot. Cast via `as unknown as <ColumnType>` because the
  // Drizzle column is strongly typed and this test doesn't read most fields.
  type WeeklyPlanSnapshot = typeof weeklyPlans.$inferInsert["inputSnapshot"];
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
  } as unknown as WeeklyPlanSnapshot;

  await db.insert(weeklyPlans).values({
    id: weeklyPlanId,
    projectId,
    year: 2026,
    isoWeek: 22,
    weekStartDate: new Date("2026-05-25"),
    weekEndDate: new Date("2026-05-31"),
    status: "approved",
    estimatedCostEur: "0",
    inputSnapshot: fixtureSnapshot,
  });

  await db.insert(plannedItems).values({
    id: plannedItemId,
    weeklyPlanId,
    projectId,
    contentType: "cluster",
    pipelineName: "article:blog",
    sourceKind: "floor",
    selectionReason: "test",
    status: "in_progress",
    estimatedCostEur: "0.1",
    slotDate: new Date("2026-05-26"),
    pipelineInput: {},
    pipelineRunId,
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HeroImageStep batch-mode branch (Spec 64.7)", () => {
  it("returns imageBatchPending signal when ctx.llmMode='batch' AND planned_item links to a plan", async () => {
    const step = new HeroImageStep();
    const ctx = makeMockCtx({ projectId, pipelineRunId, llmMode: "batch" });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);

    // Pattern 118 contract: shape returned BEFORE outputSchema.parse() runs in
    // the runner. The runner detects `imageBatchPending: true` and suspends.
    expect(result).toHaveProperty("imageBatchPending", true);
    expect(result).toHaveProperty("imageBatchRequestId");
    // Pattern 118: step returns a suspension signal that does NOT match OutputSchema;
    // mirrors the `as unknown as z.infer<typeof OutputSchema>` cast in hero-image.ts.
    const id = (result as unknown as { imageBatchRequestId: string }).imageBatchRequestId;

    // image_batch_requests row was written.
    const rows = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.id, id));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("pending");
    expect(row.weeklyPlanId).toBe(weeklyPlanId);
    expect(row.pipelineRunId).toBe(pipelineRunId);
    expect(row.geminiCustomId).toBe(`img-${pipelineRunId}`);
    expect(row.requestBody.model).toBe("nano-banana-2");
    expect(row.requestBody.resolution).toBe("1k");

    // Estimate cost log was written (stage='estimate', operation='image_batch:submit').
    const estimateLogs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.pipelineRunId, pipelineRunId));
    expect(estimateLogs).toHaveLength(1);
    expect(estimateLogs[0]!.service).toBe("google-gemini");
    expect(estimateLogs[0]!.operation).toBe("image_batch:submit");
    const meta = estimateLogs[0]!.metadata as Record<string, unknown>;
    expect(meta.stage).toBe("estimate");
    expect(meta.imageBatchRequestId).toBe(id);
    expect(meta.weeklyPlanId).toBe(weeklyPlanId);

    // Sync adapter must NOT have been called in batch mode.
    expect(nanoBananaGenerateMock).not.toHaveBeenCalled();
  });

  it("falls back to sync when ctx.llmMode='batch' but the run has no planned_item", async () => {
    // Detach the planned_item from the run.
    await db
      .update(plannedItems)
      .set({ pipelineRunId: null })
      .where(eq(plannedItems.id, plannedItemId));

    nanoBananaGenerateMock.mockClear();
    const step = new HeroImageStep();
    const ctx = makeMockCtx({ projectId, pipelineRunId, llmMode: "batch" });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);

    // Sync result (r2Key + publicUrl, no batchPending flag).
    expect(result).not.toHaveProperty("imageBatchPending");
    expect(result).toHaveProperty("r2Key");
    expect(nanoBananaGenerateMock).toHaveBeenCalledTimes(1);

    // No image_batch_requests row was written.
    const rows = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it("runs sync when ctx.llmMode='sync' (Spec 64.6 path unchanged)", async () => {
    nanoBananaGenerateMock.mockClear();
    const step = new HeroImageStep();
    const ctx = makeMockCtx({ projectId, pipelineRunId, llmMode: "sync" });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);

    expect(result).not.toHaveProperty("imageBatchPending");
    expect(nanoBananaGenerateMock).toHaveBeenCalledTimes(1);
    const rows = await db
      .select()
      .from(imageBatchRequests)
      .where(eq(imageBatchRequests.projectId, projectId));
    expect(rows).toHaveLength(0);
  });
});

describe("HeroImageStep batch-resume branch (Spec 64.7)", () => {
  it("restores r2Key + publicUrl from ctx.batchResult (worker owns the cost log)", async () => {
    const r2Key = "toolwiki/articles/hero/abc.webp";
    const publicUrl = "https://cdn.test/abc.webp";
    const responseBody = { r2Key, publicUrl, costEur: 0.031, seed: 42 };

    const step = new HeroImageStep();
    const ctx = makeMockCtx({
      projectId,
      pipelineRunId,
      llmMode: "batch",
      batchResult: { stepKey: "hero-image", content: JSON.stringify(responseBody) },
    });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);
    expect(result.r2Key).toBe(r2Key);
    expect(result.publicUrl).toBe(publicUrl);
    expect(result.altText).toContain("Test Article");
    // Spec 64.15 Phase A: pre-Phase-A responseBody omits originalR2Key. The
    // step surfaces it as null so the bridge → PersistArticleStep contract
    // stays uniform (the column is NULL-able and means "no forensic copy").
    expect(result.originalR2Key).toBeNull();

    // The image-batch-processor worker writes the authoritative actual-cost
    // log when the Gemini result arrives — the resume branch in the step
    // does NOT duplicate-write. So no cost_logs row is written by this code
    // path (the worker, not exercised in this unit test, would write it).
    const logs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.pipelineRunId, pipelineRunId));
    expect(logs).toHaveLength(0);
  });

  it("Spec 64.15 Phase A: surfaces originalR2Key from ctx.batchResult when worker stored a non-WebP original", async () => {
    // Simulates the worker's post-64.15 responseBody — convertImageToWebp
    // detected a PNG input and stored both canonical WebP + originals/<uuid>.png
    // side by side. The forensic key flows through the resume content blob.
    const r2Key = "toolwiki/articles/hero/xyz.webp";
    const publicUrl = "https://cdn.test/xyz.webp";
    const originalR2Key = "toolwiki/articles/hero/originals/xyz.png";
    const responseBody = {
      r2Key,
      publicUrl,
      originalR2Key,
      costEur: 0.031,
      seed: 42,
    };

    const step = new HeroImageStep();
    const ctx = makeMockCtx({
      projectId,
      pipelineRunId,
      llmMode: "batch",
      batchResult: { stepKey: "hero-image", content: JSON.stringify(responseBody) },
    });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);
    expect(result.r2Key).toBe(r2Key);
    expect(result.publicUrl).toBe(publicUrl);
    // The whole point of Phase A: forensic original key reaches the step
    // so the bridge can write it to articles.hero_image_original_r2_key.
    expect(result.originalR2Key).toBe(originalR2Key);
  });

  it("returns skipped+empty hero when ctx.batchResult carries an error", async () => {
    const step = new HeroImageStep();
    const ctx = makeMockCtx({
      projectId,
      pipelineRunId,
      llmMode: "batch",
      batchResult: {
        stepKey: "hero-image",
        content: JSON.stringify({
          r2Key: "",
          publicUrl: "",
          costEur: 0,
          seed: null,
          error: "Image content blocked",
        }),
      },
    });

    const result = await step.execute({ articleId, projectId, projectSlug }, ctx);
    expect(result.r2Key).toBe("");
    expect(result.publicUrl).toBe("");
    expect(result.skipped).toBe(true);

    // NO actual-cost log on the failure path — the article got nothing.
    const logs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.pipelineRunId, pipelineRunId));
    expect(logs).toHaveLength(0);
  });
});
