// Spec 62.4-followup Issue 2: SelectSocialPostItemsStep unit tests. Pure —
// DB readers are injected as fixtures via `SelectSocialPostDeps` so the
// step runs offline.

import { describe, expect, it } from "bun:test";
import type { ProjectGoal } from "@marketing-auto/db";
import type {
  PlanningItemDraft,
  SelectSocialPostDeps,
} from "../../src/planning/index.ts";
import { SelectSocialPostItemsStep } from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";
import {
  createNullArticleProvider,
  createNullBriefProvider,
} from "./lib/null-providers.ts";

const projectId = "00000000-0000-0000-0000-0000000000a1";

function goal(overrides: Partial<ProjectGoal>): ProjectGoal {
  return {
    id: crypto.randomUUID(),
    projectId,
    contentType: "social_post",
    cadenceUnit: "per_day",
    minCount: 3,
    maxCount: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    note: null,
    ...overrides,
  };
}

function clusterDraft(overrides: Partial<PlanningItemDraft> = {}): PlanningItemDraft {
  return {
    draftId: crypto.randomUUID(),
    contentType: "cluster",
    pipelineName: "cluster:full-plan",
    sourceKind: "floor",
    sourceBriefId: crypto.randomUUID(),
    sourceSignalId: null,
    parentDraftId: null,
    locale: null,
    pipelineInput: {},
    slotDate: null,
    selectionScore: null,
    selectionReason: "floor cluster",
    estimatedCostEur: null,
    ...overrides,
  };
}

function emptyDeps(): SelectSocialPostDeps {
  return {
    pickFromRefreshSuggestions: async () => [],
    pickFromSuggestionPool: async () => [],
    // Default to no-op so tests don't accidentally hit the DB. Tests that
    // need title-stamping pass an override here.
    loadArticleMeta: async () => new Map(),
    // Spec 63.5: null providers keep the diversity picker offline (returns
    // null embeddings → no malus → equivalent to FIFO ordering).
    createBriefEmbeddingProvider: createNullBriefProvider,
    createArticleEmbeddingProvider: createNullArticleProvider,
  };
}

describe("SelectSocialPostItemsStep", () => {
  it("returns empty + zero shortfall when no social_post goal is active", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return {
            goals: [goal({ isActive: false })],
          } as never;
        }
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.socialItems).toEqual([]);
    expect(out.shortfall).toBe(0);
  });

  it("pulls 1/3 of the target from today's planned clusters", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    // target = 3/day × 7 = 21 → perSourceCap = ceil(21/3) = 7
    const clusters = Array.from({ length: 10 }, () => clusterDraft());
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 3, cadenceUnit: "per_day" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: clusters } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    const fromCluster = items.filter((it) => it.parentDraftId !== null);
    expect(fromCluster).toHaveLength(7);
    // Each item references its parent cluster.
    for (const it of fromCluster) {
      expect(it.pipelineInput.parentDraftId).toBe(it.parentDraftId);
    }
  });

  it("includes refresh-suggestion candidates", async () => {
    const articleA = "00000000-0000-0000-0000-0000000000a2";
    const suggestionA = "00000000-0000-0000-0000-0000000000a3";
    const deps: SelectSocialPostDeps = {
      pickFromRefreshSuggestions: async () => [
        { suggestionId: suggestionA, articleId: articleA, generatedAt: new Date() },
      ],
      pickFromSuggestionPool: async () => [],
      loadArticleMeta: async () => new Map(),
      createBriefEmbeddingProvider: createNullBriefProvider,
      createArticleEmbeddingProvider: createNullArticleProvider,
    };
    const step = new SelectSocialPostItemsStep(deps);
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 1, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    const refreshItem = items.find((it) => it.pipelineInput.refreshSuggestionId === suggestionA);
    expect(refreshItem).toBeDefined();
    expect(refreshItem?.pipelineInput.articleId).toBe(articleA);
  });

  it("tops up with the suggestion pool and excludes refresh-pool ids", async () => {
    const articleRefresh = "00000000-0000-0000-0000-0000000000a4";
    const suggestion = "00000000-0000-0000-0000-0000000000a5";
    const articlePool = "00000000-0000-0000-0000-0000000000a6";
    let excludedSeen: string[] | undefined;
    const deps: SelectSocialPostDeps = {
      pickFromRefreshSuggestions: async () => [
        { suggestionId: suggestion, articleId: articleRefresh, generatedAt: new Date() },
      ],
      pickFromSuggestionPool: async (input) => {
        excludedSeen = input.excludeArticleIds;
        return [{ articleId: articlePool, publishedAt: new Date() }];
      },
      loadArticleMeta: async () => new Map(),
      createBriefEmbeddingProvider: createNullBriefProvider,
      createArticleEmbeddingProvider: createNullArticleProvider,
    };
    const step = new SelectSocialPostItemsStep(deps);
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 3, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    expect(excludedSeen).toEqual([articleRefresh]);
    const poolItem = items.find((it) => it.pipelineInput.articleId === articlePool);
    expect(poolItem).toBeDefined();
  });

  it("reports shortfall when all pools are empty", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 2, cadenceUnit: "per_day" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    // target = 2 × 7 = 14, all pools empty → shortfall 14.
    expect(out.socialItems).toEqual([]);
    expect(out.shortfall).toBe(14);
  });

  it("inherits parent cluster pipelineInput.title onto child social_post", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    const cluster = clusterDraft({
      pipelineInput: { briefId: crypto.randomUUID(), projectId, title: "Claude Skills Hub" },
    });
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 1, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [cluster] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    expect(items[0]!.pipelineInput["title"]).toBe("Claude Skills Hub");
  });

  it("omits title on child social_post when parent cluster has no title (graceful)", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    const cluster = clusterDraft({ pipelineInput: { projectId } });
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 1, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [cluster] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    expect(items[0]!.pipelineInput["title"]).toBeUndefined();
  });

  it("stamps article title on refresh + pool items via batch loader", async () => {
    const articleRefresh = "00000000-0000-0000-0000-0000000000b1";
    const suggestion = "00000000-0000-0000-0000-0000000000b2";
    const articlePool = "00000000-0000-0000-0000-0000000000b3";
    let loaderArgs: string[] | undefined;
    const deps: SelectSocialPostDeps = {
      pickFromRefreshSuggestions: async () => [
        { suggestionId: suggestion, articleId: articleRefresh, generatedAt: new Date() },
      ],
      pickFromSuggestionPool: async () => [
        { articleId: articlePool, publishedAt: new Date() },
      ],
      loadArticleMeta: async (ids: string[]) => {
        loaderArgs = ids;
        return new Map([
          [
            articleRefresh,
            {
              id: articleRefresh,
              title: "Refresh Article Title",
              embeddingText: "Refresh Article Title",
              clusterId: null,
            },
          ],
          [
            articlePool,
            {
              id: articlePool,
              title: "Pool Article Title",
              embeddingText: "Pool Article Title",
              clusterId: null,
            },
          ],
        ]);
      },
      createBriefEmbeddingProvider: createNullBriefProvider,
      createArticleEmbeddingProvider: createNullArticleProvider,
    };
    const step = new SelectSocialPostItemsStep(deps);
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 3, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    // Batch loader was called once with both IDs (no N+1).
    expect(loaderArgs).toEqual([articleRefresh, articlePool]);
    const refreshItem = items.find((it) => it.pipelineInput["articleId"] === articleRefresh);
    const poolItem = items.find((it) => it.pipelineInput["articleId"] === articlePool);
    expect(refreshItem?.pipelineInput["title"]).toBe("Refresh Article Title");
    expect(poolItem?.pipelineInput["title"]).toBe("Pool Article Title");
  });

  it("omits title when batch loader has no entry for the article id", async () => {
    const articleId = "00000000-0000-0000-0000-0000000000b4";
    const deps: SelectSocialPostDeps = {
      pickFromRefreshSuggestions: async () => [
        { suggestionId: "s1", articleId, generatedAt: new Date() },
      ],
      pickFromSuggestionPool: async () => [],
      loadArticleMeta: async () => new Map(),
      createBriefEmbeddingProvider: createNullBriefProvider,
      createArticleEmbeddingProvider: createNullArticleProvider,
    };
    const step = new SelectSocialPostItemsStep(deps);
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 1, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    expect(items[0]!.pipelineInput["title"]).toBeUndefined();
  });

  it("propagates parent cluster slotDate to social_post", async () => {
    const step = new SelectSocialPostItemsStep(emptyDeps());
    const fixed = new Date(Date.UTC(2026, 4, 27));
    const cluster = clusterDraft({ slotDate: fixed });
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") {
          return { goals: [goal({ minCount: 1, cadenceUnit: "per_week" })] } as never;
        }
        if (name === "select-floor-items") return { floorItems: [cluster] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.socialItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    expect(items[0]!.slotDate).toEqual(fixed);
  });
});
