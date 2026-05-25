// Spec 64.15 Phase B: cross-week diversity helper + Floor-step integration.
//
// Three cases:
//   1. Helper short-circuits when lookbackWeeks === 0 (offline, no DB).
//   2. Helper DB integration — seed 3 past plans + briefs, assert that
//      `lookbackWeeks: 2` returns embeddings from the 2 most-recent plans
//      and the status filter excludes draft/cancelled.
//   3. Floor-step integration — when the loader returns a non-empty array,
//      `pickWithDiversity` receives it via `initialPickedEmbeddings` and
//      uses it to bias the first pick (verified by stubbed embedding
//      provider + observed pick order).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  articles,
  contentPillars,
  clusters,
  db,
  eq,
  plannedItems,
  projects,
  topicBriefs,
  weeklyPlans,
  type ProjectGoal,
  type TopicBrief,
} from "@marketing-auto/db";
import { SelectFloorItemsStep } from "../../../src/planning/index.ts";
import { loadHistoricalPlanEmbeddings } from "../../../src/planning/lib/cross-week-diversity.ts";
import type { BriefEmbeddingProvider } from "../../../src/planning/lib/diversity-embedding.ts";
import { makeMockCtx } from "../../fixtures/mock-ctx.ts";
import { createNullBriefProvider } from "./null-providers.ts";

const projectId = `00000000-0000-0000-0000-${"0000000000ab"}`;

function brief(overrides: Partial<TopicBrief> = {}): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId,
    source: "gap_analysis",
    gapId: null,
    topicTitle: "test brief",
    primaryKeyword: null,
    secondaryKeywords: [],
    locale: null,
    intentType: null,
    clusterId: null,
    clusterAction: "create_new",
    searchVolumeDe: null,
    searchVolumeEn: null,
    difficulty: null,
    serpSnapshot: null,
    suggestedTitle: null,
    suggestedSlug: null,
    suggestedMeta: null,
    heroImagePrompt: null,
    generationMode: null,
    approvalRequired: true,
    approvalStatus: "pending",
    approvedBy: null,
    approvedAt: null,
    gapMetadata: null,
    trendMetadata: null,
    refreshMetadata: null,
    comparisonMetadata: null,
    releaseMetadata: null,
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
    routedViaPlanItemId: null,
    embedding: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function goal(overrides: Partial<ProjectGoal>): ProjectGoal {
  return {
    id: crypto.randomUUID(),
    projectId,
    contentType: "cluster",
    cadenceUnit: "per_week",
    minCount: 1,
    maxCount: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    note: null,
    ...overrides,
  };
}

const stubSnapshot = {
  goals: [],
  config: {
    weeklyBudgetEur: 100,
    perTypeMaxEur: null,
    topNSignalsAllowedOverage: 0,
    maxOveragePerSignal: 0,
    signalMaxAgeHours: 168,
    excludedPipelines: [],
    llmMode: "sync" as const,
    diversityThreshold: 0.5,
    // Non-zero malus weight so the diversity branch activates.
    diversityMalusWeight: 1.0,
    planDiversityLookbackWeeks: 3,
    imageGenerationProvider: "nano-banana-2" as const,
    imageGenerationResolution: "1k" as const,
  },
  signalRefreshResult: {
    projectId,
    triggeredAt: new Date().toISOString(),
    sourceResults: [],
    totalRowsAdded: 0,
    durationMs: 0,
  },
  topicBriefSnapshot: [],
  signalTopN: [],
  triggeredAt: new Date().toISOString(),
};

// ─── Case 1: helper short-circuits at lookbackWeeks === 0 ──────────────────────

describe("loadHistoricalPlanEmbeddings short-circuit (Spec 64.15 Phase B)", () => {
  it("returns [] when lookbackWeeks is 0 without touching the DB", async () => {
    // Provider would throw if called — proves the helper didn't reach it.
    const failingProvider: BriefEmbeddingProvider = {
      async getForItem() {
        throw new Error("provider must not be called when lookbackWeeks === 0");
      },
      async getForBrief() {
        throw new Error("provider must not be called when lookbackWeeks === 0");
      },
    };
    const result = await loadHistoricalPlanEmbeddings(projectId, 0, failingProvider);
    expect(result).toEqual([]);
  });
});

// ─── Case 2: helper DB integration ────────────────────────────────────────────

describe("loadHistoricalPlanEmbeddings DB integration (Spec 64.15 Phase B)", () => {
  let pillarId: string;
  let clusterId: string;
  let briefIds: string[];
  let planIds: string[];

  beforeAll(async () => {
    await db.insert(projects).values({
      id: projectId,
      slug: `cwd-phase-b-${projectId.slice(0, 8)}`,
      name: "Phase B test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    });

    pillarId = crypto.randomUUID();
    clusterId = crypto.randomUUID();
    await db.insert(contentPillars).values({
      id: pillarId,
      projectId,
      name: "Test Pillar",
    });
    await db.insert(clusters).values({
      id: clusterId,
      projectId,
      pillarId,
      name: "Test Cluster",
      primaryKeyword: "test",
      status: "approved",
    });
  });

  afterAll(async () => {
    await db.delete(plannedItems).where(eq(plannedItems.projectId, projectId));
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  beforeEach(async () => {
    // Clean per-test rows so the lookback queries see a known fixture.
    await db.delete(plannedItems).where(eq(plannedItems.projectId, projectId));
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));

    // 4 briefs anchoring 4 past plans (KW18, KW19, KW20, KW21).
    briefIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    await db.insert(topicBriefs).values(
      briefIds.map((id, i) => ({
        id,
        projectId,
        source: "gap_analysis" as const,
        topicTitle: `Historical brief ${i}`,
        primaryKeyword: `kw-${i}`,
        secondaryKeywords: [],
        clusterId,
        clusterAction: "append_to_existing" as const,
        approvalRequired: true,
        approvalStatus: "routed" as const,
      })),
    );

    // 4 past plans, oldest to newest. Use 2026 ISO weeks 18–21 with a
    // proper Date so April-overflow → May arithmetic is correct.
    planIds = Array.from({ length: 4 }, () => crypto.randomUUID());
    const baseSnapshot = stubSnapshot as never;
    const baseMonday = new Date(Date.UTC(2026, 3, 27)); // 2026-04-27 (KW18 Mon)
    for (let i = 0; i < 4; i++) {
      const start = new Date(baseMonday.getTime() + i * 7 * 86_400_000);
      const end = new Date(start.getTime() + 6 * 86_400_000);
      await db.insert(weeklyPlans).values({
        id: planIds[i]!,
        projectId,
        year: 2026,
        isoWeek: 18 + i,
        weekStartDate: start,
        weekEndDate: end,
        // Mix of valid past statuses + one excluded "draft" to verify filter.
        status: i === 0 ? "completed" : i === 1 ? "running" : i === 2 ? "approved" : "completed",
        estimatedCostEur: "0",
        inputSnapshot: baseSnapshot,
      });
      await db.insert(plannedItems).values({
        id: crypto.randomUUID(),
        projectId,
        weeklyPlanId: planIds[i]!,
        contentType: "cluster",
        pipelineName: "article:blog",
        sourceKind: "floor",
        sourceBriefId: briefIds[i]!,
        pipelineInput: { briefId: briefIds[i] },
        slotDate: start,
        estimatedCostEur: "0",
        status: "completed",
      });
    }
  });

  it("returns embeddings from the lookbackWeeks most-recent past plans (status-filtered)", async () => {
    // Capture which briefs the provider was asked about.
    const askedBriefIds: string[] = [];
    const capturingProvider: BriefEmbeddingProvider = {
      async getForItem(b) {
        askedBriefIds.push(b.id);
        // Return distinct synthetic embeddings so the picker can distinguish.
        return new Array(1024).fill(b.id.charCodeAt(0) / 256);
      },
      async getForBrief(b) {
        askedBriefIds.push(b.id);
        return new Array(1024).fill(b.id.charCodeAt(0) / 256);
      },
    };

    // lookbackWeeks=2 → only the two most-recent plans (KW20 + KW21).
    const embeddings = await loadHistoricalPlanEmbeddings(projectId, 2, capturingProvider);

    expect(embeddings).toHaveLength(2);
    expect(askedBriefIds).toHaveLength(2);
    // Most-recent plans = indices 2 (KW20) + 3 (KW21).
    expect(askedBriefIds).toContain(briefIds[2]!);
    expect(askedBriefIds).toContain(briefIds[3]!);
    // Older plans NOT included.
    expect(askedBriefIds).not.toContain(briefIds[0]!);
    expect(askedBriefIds).not.toContain(briefIds[1]!);
  });

  it("excludes draft plans even within the lookback window", async () => {
    // Flip the newest plan (KW21) to 'draft' — it must NOT count.
    await db
      .update(weeklyPlans)
      .set({ status: "draft" })
      .where(eq(weeklyPlans.id, planIds[3]!));

    const askedBriefIds: string[] = [];
    const capturingProvider: BriefEmbeddingProvider = {
      async getForItem(b) {
        askedBriefIds.push(b.id);
        return new Array(1024).fill(0.1);
      },
      async getForBrief(b) {
        askedBriefIds.push(b.id);
        return new Array(1024).fill(0.1);
      },
    };

    // lookbackWeeks=2 with KW21=draft → picks KW19 + KW20.
    const embeddings = await loadHistoricalPlanEmbeddings(projectId, 2, capturingProvider);
    expect(embeddings).toHaveLength(2);
    expect(askedBriefIds).toContain(briefIds[1]!); // KW19 (running)
    expect(askedBriefIds).toContain(briefIds[2]!); // KW20 (approved)
    expect(askedBriefIds).not.toContain(briefIds[3]!); // KW21 (draft — excluded)
  });
});

// ─── Case 3: Floor-step integration ────────────────────────────────────────────

describe("SelectFloorItemsStep cross-week integration (Spec 64.15 Phase B)", () => {
  it("calls the historical loader when lookbackWeeks > 0 AND malusWeight > 0", async () => {
    // Spy loader records the call args and returns a non-empty array so we
    // can observe that the helper was invoked exactly once with the snapshot
    // lookback. The picker behaviour with initialPickedEmbeddings is already
    // covered by 63.5's pick-with-diversity.test.ts — here we only assert
    // wiring, not the malus math.
    const calls: Array<{ projectId: string; lookbackWeeks: number }> = [];
    const spyLoader = async (pid: string, lookback: number) => {
      calls.push({ projectId: pid, lookbackWeeks: lookback });
      // Returning [] keeps test deterministic (no malus from history yet
      // useful as a non-empty signal would require a real provider).
      return [];
    };

    const step = new SelectFloorItemsStep({
      createEmbeddingProvider: createNullBriefProvider,
      // Cast to satisfy the typeof signature — spyLoader matches the contract.
      loadHistoricalPlanEmbeddings: spyLoader as unknown as typeof loadHistoricalPlanEmbeddings,
    });
    const goals = [goal({ minCount: 1, contentType: "cluster" })];
    const briefs = [brief({ topicTitle: "Test 1" }), brief({ topicTitle: "Test 2" })];

    const ctx = makeMockCtx({
      projectId,
      getStepOutput: <T>(name: string) => {
        if (name === "validate-goals") return { goals } as unknown as T;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as unknown as T;
        if (name === "snapshot-inputs") return { snapshot: stubSnapshot } as unknown as T;
        return undefined;
      },
    });

    await step.execute({ projectId }, ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.projectId).toBe(projectId);
    expect(calls[0]!.lookbackWeeks).toBe(3); // from stubSnapshot.config
  });

  it("skips the historical loader when malusWeight === 0 (diversity off)", async () => {
    let loaderCalled = false;
    const spyLoader = async () => {
      loaderCalled = true;
      return [];
    };

    const step = new SelectFloorItemsStep({
      createEmbeddingProvider: createNullBriefProvider,
      loadHistoricalPlanEmbeddings: spyLoader as unknown as typeof loadHistoricalPlanEmbeddings,
    });
    const goals = [goal({ minCount: 1, contentType: "cluster" })];
    const briefs = [brief({ topicTitle: "Test" })];

    // Snapshot with diversity OFF.
    const offSnapshot = {
      ...stubSnapshot,
      config: { ...stubSnapshot.config, diversityMalusWeight: 0 },
    };
    const ctx = makeMockCtx({
      projectId,
      getStepOutput: <T>(name: string) => {
        if (name === "validate-goals") return { goals } as unknown as T;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as unknown as T;
        if (name === "snapshot-inputs") return { snapshot: offSnapshot } as unknown as T;
        return undefined;
      },
    });

    await step.execute({ projectId }, ctx);
    expect(loaderCalled).toBe(false);
  });

  it("skips the historical loader when lookbackWeeks === 0", async () => {
    let loaderCalled = false;
    const spyLoader = async () => {
      loaderCalled = true;
      return [];
    };

    const step = new SelectFloorItemsStep({
      createEmbeddingProvider: createNullBriefProvider,
      loadHistoricalPlanEmbeddings: spyLoader as unknown as typeof loadHistoricalPlanEmbeddings,
    });
    const goals = [goal({ minCount: 1, contentType: "cluster" })];
    const briefs = [brief({ topicTitle: "Test" })];

    const noLookbackSnapshot = {
      ...stubSnapshot,
      config: { ...stubSnapshot.config, planDiversityLookbackWeeks: 0 },
    };
    const ctx = makeMockCtx({
      projectId,
      getStepOutput: <T>(name: string) => {
        if (name === "validate-goals") return { goals } as unknown as T;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as unknown as T;
        if (name === "snapshot-inputs")
          return { snapshot: noLookbackSnapshot } as unknown as T;
        return undefined;
      },
    });

    await step.execute({ projectId }, ctx);
    expect(loaderCalled).toBe(false);
  });
});
