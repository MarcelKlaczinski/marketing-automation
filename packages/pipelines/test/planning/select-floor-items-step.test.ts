// Spec 62.4 §6.1: SelectFloorItemsStep unit tests. Pure — no DB, only the
// runtime behaviour of the selection algorithm via injected ctx outputs.

import { describe, expect, it } from "bun:test";
import type { ProjectGoal, TopicBrief } from "@marketing-auto/db";
import {
  matchBriefToContentType,
  SelectFloorItemsStep,
  targetWeeklyCount,
} from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const projectId = "00000000-0000-0000-0000-0000000000aa";

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
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
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

describe("matchBriefToContentType", () => {
  it("maps comparison_discovery → comparison", () => {
    expect(matchBriefToContentType(brief({ source: "comparison_discovery" }))).toBe("comparison");
  });

  it("maps cluster_action='comparison' → comparison", () => {
    expect(matchBriefToContentType(brief({ clusterAction: "comparison" }))).toBe("comparison");
  });

  it("returns null for translation briefs", () => {
    expect(matchBriefToContentType(brief({ clusterAction: "translation" }))).toBeNull();
  });

  it("returns null for refresh briefs", () => {
    expect(matchBriefToContentType(brief({ clusterAction: "refresh" }))).toBeNull();
  });

  it("maps standalone+knowledge intentType → ki_wissen", () => {
    expect(
      matchBriefToContentType(brief({ clusterAction: "standalone", intentType: "knowledge" })),
    ).toBe("ki_wissen");
  });

  it("default cluster_action='create_new' → cluster", () => {
    expect(matchBriefToContentType(brief({ clusterAction: "create_new" }))).toBe("cluster");
  });
});

describe("targetWeeklyCount", () => {
  it("multiplies per_day goals by 7", () => {
    expect(targetWeeklyCount({ cadenceUnit: "per_day", minCount: 3 })).toBe(21);
  });

  it("returns per_week as-is", () => {
    expect(targetWeeklyCount({ cadenceUnit: "per_week", minCount: 4 })).toBe(4);
  });
});

describe("SelectFloorItemsStep", () => {
  const step = new SelectFloorItemsStep();

  it("picks the first N briefs FIFO when supply is enough", async () => {
    const briefs = [
      brief({ topicTitle: "b1", clusterAction: "create_new" }),
      brief({ topicTitle: "b2", clusterAction: "create_new" }),
      brief({ topicTitle: "b3", clusterAction: "create_new" }),
    ];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 2 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.floorItems).toHaveLength(2);
    expect(out.shortfallsByContentType).toEqual({});
  });

  it("returns shortfall when supply < target without erroring", async () => {
    const briefs = [brief({ clusterAction: "create_new" })];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 5 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.floorItems).toHaveLength(1);
    expect(out.shortfallsByContentType.cluster).toBe(4);
  });

  it("skips inactive and zero-min goals", async () => {
    const briefs = [brief({ clusterAction: "create_new" })];
    const goals = [
      goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1, isActive: false }),
      goal({ contentType: "comparison", cadenceUnit: "per_week", minCount: 0 }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.floorItems).toHaveLength(0);
  });

  it("buckets briefs by content type independently per goal", async () => {
    const briefs = [
      brief({ clusterAction: "comparison" }),
      brief({ clusterAction: "comparison" }),
      brief({ clusterAction: "create_new" }),
    ];
    const goals = [
      goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1 }),
      goal({ contentType: "comparison", cadenceUnit: "per_week", minCount: 2 }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ contentType: string }>;
    expect(items.filter((i) => i.contentType === "cluster")).toHaveLength(1);
    expect(items.filter((i) => i.contentType === "comparison")).toHaveLength(2);
  });

  it("emits cluster items with locale=null (Spec 62.4-followup Issue 1)", async () => {
    // Pre-Issue-1 the cluster items inherited brief.locale ('de') and
    // ApplySiblingLocaleStep cloned an EN sibling. Post-fix: locale stays
    // null because cluster:full-plan → article:blog → article:translation
    // produces DE+EN internally.
    const briefs = [
      brief({ clusterAction: "create_new", locale: "de" }),
      brief({ clusterAction: "create_new", locale: "en" }),
    ];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 2 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ contentType: string; locale: string | null }>;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.contentType).toBe("cluster");
      expect(item.locale).toBeNull();
    }
  });

  it("skips social_post goals — handled by SelectSocialPostItemsStep (Theme 62 follow-up)", async () => {
    // Pre-fix: SelectFloorItemsStep iterated every goal including social_post.
    // Since briefs never map to "social_post" (matchBriefToContentType has no
    // such branch), the social bucket was always empty and the step reported
    // a false-positive shortfall — even when the dedicated SelectSocialPostItemsStep
    // had filled the cadence elsewhere. Confirm the skip:
    const briefs = [
      brief({ clusterAction: "create_new" }),
      brief({ clusterAction: "create_new" }),
    ];
    const goals = [
      goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1 }),
      goal({ contentType: "social_post", cadenceUnit: "per_day", minCount: 3 }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ contentType: string }>;
    expect(items.filter((i) => i.contentType === "social_post")).toHaveLength(0);
    expect(out.shortfallsByContentType.social_post).toBeUndefined();
  });

  it("preserves brief.locale for non-cluster content types", async () => {
    const briefs = [
      brief({ clusterAction: "comparison", locale: "de" }),
      brief({ clusterAction: "standalone", intentType: "knowledge", locale: "en" }),
    ];
    const goals = [
      goal({ contentType: "comparison", cadenceUnit: "per_week", minCount: 1 }),
      goal({ contentType: "ki_wissen", cadenceUnit: "per_week", minCount: 1 }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ contentType: string; locale: string | null }>;
    const comp = items.find((i) => i.contentType === "comparison");
    const ki = items.find((i) => i.contentType === "ki_wissen");
    expect(comp?.locale).toBe("de");
    expect(ki?.locale).toBe("en");
  });
});
