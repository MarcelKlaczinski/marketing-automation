// Spec 62.4 §6.1: SelectOverageItemsStep unit tests.

import { describe, expect, it } from "bun:test";
import type { ProjectPlannerConfig } from "@marketing-auto/db";
import type {
  PlanningItemDraft,
} from "../../src/planning/index.ts";
import {
  inferContentTypeFromSignal,
  SelectOverageItemsStep,
} from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const projectId = "00000000-0000-0000-0000-0000000000ab";

function config(overrides: Partial<ProjectPlannerConfig> = {}): ProjectPlannerConfig {
  return {
    projectId,
    weeklyBudgetEur: "50.00",
    perTypeMaxEur: null,
    topNSignalsAllowedOverage: 3,
    maxOveragePerSignal: 1,
    signalMaxAgeHours: 24,
    excludedPipelines: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function signal(overrides: Partial<{
  signalId: string;
  source: string;
  title: string;
  url: string | null;
  rawScore: number;
  normalizedScore: number;
}>) {
  return {
    signalId: crypto.randomUUID(),
    source: "producthunt",
    title: "x",
    url: null,
    rawScore: 100,
    normalizedScore: 0.8,
    ...overrides,
  };
}

function snapshot(signalTopN: ReturnType<typeof signal>[]) {
  return {
    goals: [],
    config: {
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      signalMaxAgeHours: 24,
      excludedPipelines: [],
    },
    signalRefreshResult: {
      projectId,
      triggeredAt: new Date().toISOString(),
      sourceResults: [],
      totalRowsAdded: 0,
      durationMs: 0,
    },
    topicBriefSnapshot: [],
    signalTopN,
    triggeredAt: new Date().toISOString(),
  };
}

describe("inferContentTypeFromSignal", () => {
  it("producthunt → social_post", () => {
    expect(inferContentTypeFromSignal("producthunt")).toBe("social_post");
  });
  it("hackernews → ki_wissen", () => {
    expect(inferContentTypeFromSignal("hackernews")).toBe("ki_wissen");
  });
  it("returns null for unknown source", () => {
    expect(inferContentTypeFromSignal("unknown")).toBeNull();
  });
});

describe("SelectOverageItemsStep", () => {
  const step = new SelectOverageItemsStep();

  it("emits maxOveragePerSignal items per qualifying signal", async () => {
    const sigs = [signal({ source: "producthunt" }), signal({ source: "hackernews" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config({ maxOveragePerSignal: 1 }) } as never;
        if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
        if (name === "select-floor-items") return { floorItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.overageItems).toHaveLength(2);
  });

  it("skips signals already represented in floor items", async () => {
    const reused = signal({ source: "producthunt" });
    const floor: PlanningItemDraft = {
      draftId: crypto.randomUUID(),
      contentType: "social_post",
      pipelineName: "article:social-image",
      sourceKind: "floor",
      sourceBriefId: null,
      sourceSignalId: reused.signalId,
      parentDraftId: null,
      locale: null,
      pipelineInput: {},
      slotDate: null,
      selectionScore: null,
      selectionReason: "floor",
      estimatedCostEur: null,
    };
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config() } as never;
        if (name === "snapshot-inputs") return { snapshot: snapshot([reused]) } as never;
        if (name === "select-floor-items") return { floorItems: [floor] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.overageItems).toHaveLength(0);
  });

  it("respects topNSignalsAllowedOverage", async () => {
    const sigs = [
      signal({ source: "producthunt", normalizedScore: 0.9 }),
      signal({ source: "hackernews", normalizedScore: 0.7 }),
      signal({ source: "reddit", normalizedScore: 0.5 }),
      signal({ source: "github", normalizedScore: 0.3 }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config({ topNSignalsAllowedOverage: 2 }) } as never;
        if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
        if (name === "select-floor-items") return { floorItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.overageItems).toHaveLength(2);
  });

  it("emits maxOveragePerSignal=2 → 2 items per signal", async () => {
    const sigs = [signal({ source: "producthunt" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config({ maxOveragePerSignal: 2 }) } as never;
        if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
        if (name === "select-floor-items") return { floorItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.overageItems as PlanningItemDraft[];
    expect(items).toHaveLength(2);
    expect(items[0]!.selectionReason).toContain("Top-1");
    expect(items[1]!.selectionReason).toContain("Top-2");
  });
});
