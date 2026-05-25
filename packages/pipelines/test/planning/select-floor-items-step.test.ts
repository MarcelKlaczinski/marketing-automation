// Spec 62.4 §6.1: SelectFloorItemsStep unit tests. Pure — no DB, only the
// runtime behaviour of the selection algorithm via injected ctx outputs.

import { describe, expect, it } from "bun:test";
import type { ProjectGoal, TopicBrief } from "@marketing-auto/db";
import {
  matchBriefToContentType,
  SelectFloorItemsStep,
  targetWeeklyCount,
  weeklyMaxFromGoal,
} from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";
import { createNullBriefProvider } from "./lib/null-providers.ts";

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
    releaseMetadata: null,
    starTrendMetadata: null,
    recurringMetadata: null,
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

  // Spec 63.4: knowledge → ki_wissen regardless of clusterAction (Hub-Spoke).
  it("maps append_to_existing+knowledge → ki_wissen (Hub-Spoke)", () => {
    expect(
      matchBriefToContentType(brief({
        clusterAction: "append_to_existing",
        clusterId: "11111111-1111-1111-1111-111111111111",
        intentType: "knowledge",
      })),
    ).toBe("ki_wissen");
  });

  // Spec 63.4: knowledge wins over the cluster-bucket default even with create_new.
  it("maps create_new+knowledge → ki_wissen", () => {
    expect(
      matchBriefToContentType(brief({ clusterAction: "create_new", intentType: "knowledge" })),
    ).toBe("ki_wissen");
  });

  // Spec 63.4 regression: tutorial+cluster still routes to cluster (tool-specific
  // tutorials live under the tool cluster, not in ki-wissen).
  // Spec 64.1: append_to_existing with a stamped clusterId is the new
  // cluster_spoke bucket. This was "cluster" pre-64.1 (then routed to
  // article:blog via the 63.7b in-router branch) — now matchBriefToContentType
  // owns the split so Plan-Goals can target spokes separately.
  it("maps append_to_existing+tutorial+clusterId → cluster_spoke (Spec 64.1)", () => {
    expect(
      matchBriefToContentType(brief({
        clusterAction: "append_to_existing",
        clusterId: "11111111-1111-1111-1111-111111111111",
        intentType: "tutorial",
      })),
    ).toBe("cluster_spoke");
  });

  it("maps append_to_existing+general+clusterId → cluster_spoke (Spec 64.1)", () => {
    expect(
      matchBriefToContentType(brief({
        clusterAction: "append_to_existing",
        clusterId: "22222222-2222-2222-2222-222222222222",
        intentType: "general",
      })),
    ).toBe("cluster_spoke");
  });

  it("orphan append_to_existing (no clusterId) falls through to cluster (Spec 64.1 safe default)", () => {
    // The pipeline-router's cluster case also has a defensive backstop that
    // re-routes orphan appends to cluster:full-plan. Misclassified briefs stay
    // executable instead of producing a NULL cluster spoke.
    expect(
      matchBriefToContentType(brief({
        clusterAction: "append_to_existing",
        clusterId: null,
        intentType: "tutorial",
      })),
    ).toBe("cluster");
  });

  it("default cluster_action='create_new' → cluster", () => {
    expect(matchBriefToContentType(brief({ clusterAction: "create_new" }))).toBe("cluster");
  });

  // Spec 63.3b A.3: intent_type='comparison' routes ONLY when concrete tool slugs are present.
  it("intentType='comparison' with ≥2 tool slugs in comparisonMetadata → comparison", () => {
    const b = brief({
      source: "trend_discovery",
      clusterAction: "create_new",
      intentType: "comparison",
      comparisonMetadata: {
        toolASlug: "claude",
        toolBSlug: "gpt",
        toolAName: "Claude",
        toolBName: "GPT",
        coMentionCount: 0,
        coMentionArticleIds: [],
        score: 0,
        categoryOverlap: false,
        recencyBoost: 0,
        reason: "",
      },
    });
    expect(matchBriefToContentType(b)).toBe("comparison");
  });

  it("intentType='comparison' without tool slugs falls through to cluster", () => {
    const b = brief({
      source: "trend_discovery",
      clusterAction: "create_new",
      intentType: "comparison",
      comparisonMetadata: null,
    });
    expect(matchBriefToContentType(b)).toBe("cluster");
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

// Spec 64.2: per-goal weekly maximum — mirrors targetWeeklyCount semantics
// so cap and target compare apples-to-apples in the Floor cap math.
describe("weeklyMaxFromGoal (Spec 64.2)", () => {
  it("returns null when maxCount is null (no cap)", () => {
    expect(weeklyMaxFromGoal({ cadenceUnit: "per_week", maxCount: null })).toBeNull();
  });

  it("multiplies per_day maxCount by 7", () => {
    expect(weeklyMaxFromGoal({ cadenceUnit: "per_day", maxCount: 1 })).toBe(7);
    expect(weeklyMaxFromGoal({ cadenceUnit: "per_day", maxCount: 3 })).toBe(21);
  });

  it("returns per_week maxCount as-is", () => {
    expect(weeklyMaxFromGoal({ cadenceUnit: "per_week", maxCount: 5 })).toBe(5);
  });

  it("returns 0 when maxCount is 0 (explicit disable)", () => {
    expect(weeklyMaxFromGoal({ cadenceUnit: "per_week", maxCount: 0 })).toBe(0);
  });
});

describe("SelectFloorItemsStep", () => {
  // Spec 63.5: inject a null embedding provider so the diversity-aware
  // cluster bucket falls back to FIFO without hitting Voyage / cost_logs.
  const step = new SelectFloorItemsStep({
    createEmbeddingProvider: createNullBriefProvider,
  });

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

  it("stamps pipelineInput.title from brief.suggestedTitle when set", async () => {
    const briefs = [
      brief({
        topicTitle: "raw title",
        suggestedTitle: "Polished Headline",
        clusterAction: "create_new",
      }),
    ];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ pipelineInput: Record<string, unknown> }>;
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error("expected one item");
    expect(item.pipelineInput["title"]).toBe("Polished Headline");
  });

  it("falls back to brief.topicTitle when suggestedTitle is null", async () => {
    const briefs = [
      brief({ topicTitle: "Raw Headline", suggestedTitle: null, clusterAction: "create_new" }),
    ];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{ pipelineInput: Record<string, unknown> }>;
    const item = items[0];
    if (!item) throw new Error("expected one item");
    expect(item.pipelineInput["title"]).toBe("Raw Headline");
  });

  // Spec 63.7b + 64.1: append_to_existing briefs now land in the
  // `cluster_spoke` bucket (not `cluster`). The clusterAction/clusterId/
  // intentType stamping still happens so the router can pick the correct
  // collectionType WITHOUT re-querying topic_briefs.
  it("routes append_to_existing into cluster_spoke bucket + stamps cluster fields (Spec 63.7b + 64.1)", async () => {
    const briefs = [
      brief({
        clusterAction: "append_to_existing",
        clusterId: "22222222-2222-2222-2222-222222222222",
        intentType: "tutorial",
        topicTitle: "spoke topic",
      }),
    ];
    const goals = [goal({ contentType: "cluster_spoke", cadenceUnit: "per_week", minCount: 1 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{
      contentType: string;
      pipelineName: string;
      pipelineInput: Record<string, unknown>;
    }>;
    const item = items[0];
    if (!item) throw new Error("expected one item");
    expect(item.contentType).toBe("cluster_spoke");
    expect(item.pipelineInput["clusterAction"]).toBe("append_to_existing");
    expect(item.pipelineInput["clusterId"]).toBe("22222222-2222-2222-2222-222222222222");
    expect(item.pipelineInput["intentType"]).toBe("tutorial");
    // 64.1: pipelineName defaults to article:blog via PIPELINE_NAME_BY_CONTENT_TYPE
    // — no per-item override needed since the content_type already discriminates.
    expect(item.pipelineName).toBe("article:blog");
  });

  it("keeps pipelineName='cluster:full-plan' for create_new cluster items (Spec 63.7b)", async () => {
    const briefs = [
      brief({
        clusterAction: "create_new",
        clusterId: null,
        intentType: null,
      }),
    ];
    const goals = [goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 1 })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { goals } as never;
        if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.floorItems as Array<{
      pipelineName: string;
      pipelineInput: Record<string, unknown>;
    }>;
    const item = items[0];
    if (!item) throw new Error("expected one item");
    expect(item.pipelineName).toBe("cluster:full-plan");
    expect(item.pipelineInput["clusterAction"]).toBe("create_new");
    // null cluster_id / intent_type are omitted (not stamped) to keep the
    // jsonb payload tight and to let the router's `typeof === "string"`
    // narrowing skip them cleanly.
    expect(item.pipelineInput["clusterId"]).toBeUndefined();
    expect(item.pipelineInput["intentType"]).toBeUndefined();
  });

  it("stamps clusterId on comparison items, leaves ki_wissen untouched (Spec 63.7b + 64.18)", async () => {
    // Spec 63.7b originally asserted "neither comparison nor ki_wissen stamps
    // clusterId". Spec 64.18 narrowed that: comparison briefs (whose clusterId
    // is now resolver-stamped at brief-creation by `comparison-discovery.ts`)
    // DO carry it through to pipelineInput so the router can spread it into
    // article:blog jobData. `clusterAction` and `intentType` are still skipped
    // (only the `cluster` + `cluster_spoke` content_types use those for
    // route-discrimination).
    const briefs = [
      brief({ clusterAction: "comparison", clusterId: "ccc11111-1111-1111-1111-111111111111" }),
      brief({
        clusterAction: "append_to_existing",
        clusterId: "kkk22222-2222-2222-2222-222222222222",
        intentType: "knowledge",
      }),
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
    const items = out.floorItems as Array<{
      contentType: string;
      pipelineInput: Record<string, unknown>;
    }>;
    const comparisonItem = items.find((it) => it.contentType === "comparison");
    const kiWissenItem = items.find((it) => it.contentType === "ki_wissen");
    expect(comparisonItem).toBeDefined();
    expect(kiWissenItem).toBeDefined();
    if (comparisonItem) {
      // Spec 64.18: comparison items now forward the resolver-stamped clusterId.
      expect(comparisonItem.pipelineInput["clusterId"]).toBe(
        "ccc11111-1111-1111-1111-111111111111",
      );
      // Other routing-discriminator fields still skipped.
      expect(comparisonItem.pipelineInput["clusterAction"]).toBeUndefined();
      expect(comparisonItem.pipelineInput["intentType"]).toBeUndefined();
    }
    if (kiWissenItem) {
      // Pre-64.18 behaviour unchanged for ki_wissen.
      expect(kiWissenItem.pipelineInput["clusterAction"]).toBeUndefined();
      expect(kiWissenItem.pipelineInput["clusterId"]).toBeUndefined();
      expect(kiWissenItem.pipelineInput["intentType"]).toBeUndefined();
    }
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

  // Spec 64.2: Floor cap by weeklyMaxFromGoal — under normal validator-gated
  // input (max >= min in raw int), cap === target so behaviour matches
  // pre-64.2. These tests document the cap is wired in correctly for
  // future code paths or direct-DB inserts that bypass the validator.
  describe("Spec 64.2 — floor cap by max_count", () => {
    it("uncapped goal (maxCount=null) picks min like before", async () => {
      const briefs = [
        brief({ topicTitle: "b1", clusterAction: "create_new" }),
        brief({ topicTitle: "b2", clusterAction: "create_new" }),
        brief({ topicTitle: "b3", clusterAction: "create_new" }),
      ];
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 2, maxCount: null }),
      ];
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

    it("cap >= target is a no-op (per_week min=2 max=5)", async () => {
      const briefs = Array.from({ length: 10 }, (_, i) =>
        brief({ topicTitle: `b${i}`, clusterAction: "create_new" }),
      );
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 2, maxCount: 5 }),
      ];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals") return { goals } as never;
          if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      // Picks min (2), max=5 only matters for Overage.
      expect(out.floorItems).toHaveLength(2);
      expect(out.shortfallsByContentType).toEqual({});
    });

    it("per_day min=1 max=1 produces 7 floor items (cadence×7 on both sides)", async () => {
      const briefs = Array.from({ length: 10 }, (_, i) =>
        brief({ topicTitle: `b${i}`, clusterAction: "create_new" }),
      );
      const goals = [
        goal({ contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: 1 }),
      ];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals") return { goals } as never;
          if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      expect(out.floorItems).toHaveLength(7); // 1/day × 7 days
      expect(out.shortfallsByContentType).toEqual({});
    });

    it("selectionReason reflects cap (not target) when downsizing", async () => {
      // Defensive case: hand-crafted goal that the validator would normally
      // block (max < min). Tests that the cap path is wired through to the
      // selectionReason string. Validator-gated callers won't hit this.
      const briefs = Array.from({ length: 5 }, (_, i) =>
        brief({ topicTitle: `b${i}`, clusterAction: "create_new" }),
      );
      const goals = [
        // minCount=5, maxCount=2 (invalid per validator but exercises the cap path)
        goal({ contentType: "cluster", cadenceUnit: "per_week", minCount: 5, maxCount: 2 }),
      ];
      const ctx = makeMockCtx({
        getStepOutput: (name) => {
          if (name === "validate-goals") return { goals } as never;
          if (name === "load-topic-briefs") return { topicBriefs: briefs } as never;
          return undefined;
        },
      });
      const out = await step.execute({ projectId }, ctx);
      // cap=2, so only 2 items emitted even though pool has 5.
      expect(out.floorItems).toHaveLength(2);
      // shortfall = target(5) - picked(2) = 3
      expect(out.shortfallsByContentType).toEqual({ cluster: 3 });
      const items = out.floorItems as Array<{ selectionReason: string }>;
      // selectionReason cites the cap count (2), not the original target (5)
      expect(items[0]?.selectionReason).toMatch(/#1\/2/);
    });
  });
});
