// Spec 62.4 §6.1: SelectOverageItemsStep unit tests.

import { describe, expect, it } from "bun:test";
import type { ProjectGoal, ProjectPlannerConfig } from "@marketing-auto/db";
import type {
  PlanningItemDraft,
} from "../../src/planning/index.ts";
import {
  inferContentTypeFromSignal,
  SelectOverageItemsStep,
} from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";
import {
  createNullBriefProvider,
  createNullSignalProvider,
} from "./lib/null-providers.ts";

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
    // Spec 62.7 cron-trigger fields — NOT NULL on the schema since the WIP.
    cronEnabled: false,
    cronDayOfWeek: 0,
    cronHourUtc: 18,
    // Spec 63.3b: comparison-discovery cron fields, also NOT NULL.
    comparisonCronEnabled: false,
    comparisonCronDayOfWeek: 0,
    comparisonCronHourUtc: 6,
    // Spec 63.4: trends_synthesizer cron fields. dayOfWeek nullable → daily.
    trendSynthCronEnabled: false,
    trendSynthCronDayOfWeek: null,
    trendSynthCronHourUtc: 1,
    // Spec 63.5: numeric(4,3) on the DB side → string at the Drizzle boundary.
    diversityThreshold: "0.5",
    diversityMalusWeight: "0.5",
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
  const step = new SelectOverageItemsStep({
    createBriefEmbeddingProvider: createNullBriefProvider,
    createSignalEmbeddingProvider: createNullSignalProvider,
  });

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

  it("mirrors signal.title into both pipelineInput.signalTitle and pipelineInput.title", async () => {
    const sigs = [signal({ source: "producthunt", title: "GPT-5 launches in beta" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config() } as never;
        if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
        if (name === "select-floor-items") return { floorItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.overageItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    const pi = items[0]!.pipelineInput;
    expect(pi["signalTitle"]).toBe("GPT-5 launches in beta");
    expect(pi["title"]).toBe("GPT-5 launches in beta");
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

  // Spec 64.2: per-content-type cap = weeklyMaxFromGoal(goal) - floorPicked(C).
  // When floor already fills the cap, overage emits nothing for that type
  // even if matching signals exist. When goal.max_count is null, overage stays
  // uncapped (pre-64.2 behaviour preserved). The cap decrements per emit so
  // multiple signals of the same type don't all squeak through.
  describe("Spec 64.2 — overage cap by max_count", () => {
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
    function floorItem(contentType: string, sourceSignalId: string | null = null): PlanningItemDraft {
      return {
        draftId: crypto.randomUUID(),
        contentType: contentType as PlanningItemDraft["contentType"],
        pipelineName: "article:blog",
        sourceKind: "floor",
        sourceBriefId: null,
        sourceSignalId,
        parentDraftId: null,
        locale: null,
        pipelineInput: {},
        slotDate: null,
        selectionScore: null,
        selectionReason: "floor",
        estimatedCostEur: null,
      };
    }

    it("emits 0 overage when floor already at cap (per_day cluster min=1 max=1)", async () => {
      // Marcel's KW21 scenario: per_day min=1 max=1 → weeklyMax=7, floor
      // picked 7. Overage cap for cluster = 7 - 7 = 0 → trend signal skipped.
      const sigs = [signal({ source: "dataforseo_trends", title: "GitHub trend" })];
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: 1 }),
      ];
      const floors = Array.from({ length: 7 }, () => floorItem("cluster"));
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals") return { config: config(), goals } as never;
          if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
          if (name === "select-floor-items") return { floorItems: floors } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      expect(out.overageItems).toHaveLength(0);
    });

    it("emits up to remaining cap when floor partially fills (per_week min=2 max=5)", async () => {
      // weeklyMax = 5, floor picked 2 → 3 remaining for overage.
      const sigs = [
        signal({ source: "vendor_rss", title: "Trend A", normalizedScore: 0.9 }),
        signal({ source: "vendor_rss", title: "Trend B", normalizedScore: 0.8 }),
        signal({ source: "vendor_rss", title: "Trend C", normalizedScore: 0.7 }),
        signal({ source: "vendor_rss", title: "Trend D", normalizedScore: 0.6 }),
      ];
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 2, maxCount: 5 }),
      ];
      const floors = [floorItem("cluster"), floorItem("cluster")];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals")
            return { config: config({ topNSignalsAllowedOverage: 4 }), goals } as never;
          if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
          if (name === "select-floor-items") return { floorItems: floors } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      // 3 emitted (5 cap - 2 floor = 3 remaining); 4th signal dropped.
      expect(out.overageItems).toHaveLength(3);
    });

    it("emits uncapped when goal.maxCount is null", async () => {
      const sigs = [
        signal({ source: "vendor_rss", title: "T1", normalizedScore: 0.9 }),
        signal({ source: "vendor_rss", title: "T2", normalizedScore: 0.8 }),
        signal({ source: "vendor_rss", title: "T3", normalizedScore: 0.7 }),
      ];
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1, maxCount: null }),
      ];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals")
            return { config: config({ topNSignalsAllowedOverage: 3 }), goals } as never;
          if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
          if (name === "select-floor-items") return { floorItems: [] } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      expect(out.overageItems).toHaveLength(3);
    });

    it("emits uncapped when no matching goal exists (signals route through pre-64.2 behaviour)", async () => {
      // No `cluster` goal at all. Floor will skip cluster but Overage with
      // a `dataforseo_trends → cluster` signal should still emit because
      // remainingCapByCT.get("cluster") returns undefined → uncapped.
      const sigs = [signal({ source: "vendor_rss", title: "T1" })];
      const goals: ProjectGoal[] = []; // empty
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals") return { config: config(), goals } as never;
          if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
          if (name === "select-floor-items") return { floorItems: [] } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      expect(out.overageItems).toHaveLength(1);
    });

    it("decrements per emit so multi-emit doesn't blow past cap", async () => {
      // 2 signals × maxOveragePerSignal=2 = 4 raw emits, but cap leaves 3.
      // First signal emits 2, second signal emits only 1 (decrement honoured).
      const sigs = [
        signal({ source: "vendor_rss", title: "A", normalizedScore: 0.9 }),
        signal({ source: "vendor_rss", title: "B", normalizedScore: 0.8 }),
      ];
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 0, maxCount: 3 }),
      ];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals")
            return {
              config: config({ topNSignalsAllowedOverage: 2, maxOveragePerSignal: 2 }),
              goals,
            } as never;
          if (name === "snapshot-inputs") return { snapshot: snapshot(sigs) } as never;
          if (name === "select-floor-items") return { floorItems: [] } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      expect(out.overageItems).toHaveLength(3);
    });
  });
});
