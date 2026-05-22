// Spec 62.8: pipeline-router is a pure function — these tests verify the
// dispatch shape for all 4 content types + the cluster inline-vs-enqueue
// branch, with no DB or BullMQ stubs needed.

import { describe, expect, it } from "bun:test";
import type { PlannedItem } from "@marketing-auto/db";
import { getPipelineForItem } from "../src/execution/pipeline-router.ts";

type RouterItem = Pick<PlannedItem, "id" | "contentType" | "pipelineInput">;

function mkItem(overrides: Partial<RouterItem>): RouterItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    contentType: "comparison",
    pipelineInput: { briefId: "brief-1", projectId: "proj-1", title: "X vs Y" },
    ...overrides,
  };
}

describe("getPipelineForItem", () => {
  it("routes cluster items to the inline cluster:full-plan path (create_new default)", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: {
        briefId: "brief-99",
        projectId: "proj-1",
        title: "AI Coding",
        clusterAction: "create_new",
      },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("inline");
    if (route.kind === "inline") {
      expect(route.action).toBe("cluster:full-plan");
      expect(route.briefId).toBe("brief-99");
    }
  });

  it("routes cluster items inline when clusterAction missing (legacy plan back-compat)", () => {
    const item = mkItem({
      contentType: "cluster",
      // No clusterAction stamped — pre-63.7b planned_items behaved this way.
      pipelineInput: { briefId: "brief-legacy", projectId: "proj-1", title: "Legacy" },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("inline");
  });

  it("throws when a cluster item has no briefId", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: { projectId: "proj-1" },
    });
    expect(() => getPipelineForItem(item, "sync")).toThrow(/missing/);
  });

  // Spec 63.7b: append_to_existing routes to article:blog spoke generation.
  it("routes cluster append_to_existing + clusterId → article:blog (Spec 63.7b)", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: {
        briefId: "brief-spoke",
        projectId: "proj-1",
        title: "Claude vs GPT — RAG patterns",
        clusterAction: "append_to_existing",
        clusterId: "cluster-rag",
        intentType: "tutorial",
      },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:blog");
      expect(route.jobData.briefId).toBe("brief-spoke");
      expect(route.jobData.projectId).toBe("proj-1");
      expect(route.jobData.plannedItemId).toBe(item.id);
      // tutorial intent → blog collection default
      expect(route.jobData.collectionType).toBe("blog");
      expect(route.jobData.llmMode).toBe("sync");
    }
  });

  it("routes cluster append_to_existing + knowledge intent → article:blog with ki-wissen collection", () => {
    // Spec 63.4 hub-spoke: a knowledge brief matched to any cluster falls under
    // ki-wissen by intent (matchBriefToContentType routes it to ki_wissen bucket,
    // so this path is rare for knowledge — but the helper's mapping is the
    // contract that future intents can rely on).
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: {
        briefId: "brief-know",
        projectId: "proj-1",
        clusterAction: "append_to_existing",
        clusterId: "cluster-ai",
        intentType: "knowledge",
      },
    });
    const route = getPipelineForItem(item, "batch");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.jobData.collectionType).toBe("ki-wissen");
      expect(route.jobData.llmMode).toBe("batch");
    }
  });

  it("routes cluster append_to_existing + use_case intent → article:blog with usecases collection", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: {
        briefId: "brief-uc",
        projectId: "proj-1",
        clusterAction: "append_to_existing",
        clusterId: "cluster-uc",
        intentType: "use_case",
      },
    });
    const route = getPipelineForItem(item, "sync");
    if (route.kind === "enqueue") {
      expect(route.jobData.collectionType).toBe("usecases");
    }
  });

  it("falls back to inline cluster:full-plan when append_to_existing missing clusterId", () => {
    // Defensive: a misclassified brief (action says append, but no cluster set)
    // must NOT enqueue a spoke against a NULL cluster. The router falls through
    // to cluster:full-plan which will create a fresh cluster.
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: {
        briefId: "brief-misc",
        projectId: "proj-1",
        clusterAction: "append_to_existing",
        // clusterId intentionally absent
      },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("inline");
  });

  // Spec 64.1: cluster_spoke is the new first-class bucket for
  // append_to_existing briefs — same dispatch shape as the cluster legacy
  // backstop, but reached via the dedicated content_type so Plan-Goals can
  // count spokes separately.
  it("routes cluster_spoke → article:blog (Spec 64.1)", () => {
    const item = mkItem({
      contentType: "cluster_spoke",
      pipelineInput: {
        briefId: "brief-spoke",
        projectId: "proj-1",
        title: "Claude Sonnet 4.6 review",
        clusterAction: "append_to_existing",
        clusterId: "cluster-claude",
        intentType: "tutorial",
      },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:blog");
      expect(route.jobData.briefId).toBe("brief-spoke");
      expect(route.jobData.projectId).toBe("proj-1");
      expect(route.jobData.collectionType).toBe("blog");
      expect(route.jobData.plannedItemId).toBe(item.id);
      expect(route.jobData.llmMode).toBe("sync");
    }
  });

  it("routes cluster_spoke with knowledge intent → ki-wissen collection (Spec 64.1)", () => {
    const item = mkItem({
      contentType: "cluster_spoke",
      pipelineInput: {
        briefId: "brief-know-spoke",
        projectId: "proj-1",
        clusterAction: "append_to_existing",
        clusterId: "cluster-ai",
        intentType: "knowledge",
      },
    });
    const route = getPipelineForItem(item, "batch");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.jobData.collectionType).toBe("ki-wissen");
      expect(route.jobData.llmMode).toBe("batch");
    }
  });

  it("throws when a cluster_spoke item has no briefId (Spec 64.1)", () => {
    const item = mkItem({
      contentType: "cluster_spoke",
      pipelineInput: { projectId: "proj-1", clusterId: "cluster-x" },
    });
    expect(() => getPipelineForItem(item, "sync")).toThrow(/missing/);
  });

  it("routes comparison → article:blog with collectionType=comparison (Spec 63.7b enum fix)", () => {
    // Pre-63.7b this returned the Astro folder name "comparisons" (plural),
    // which was dead code (executor dropped it). Now the executor threads it
    // through, so it must match the `ArticleCollectionType` enum value
    // ("comparison" singular) or `BlogPipelineInputSchema` validation rejects it.
    const item = mkItem({ contentType: "comparison" });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:blog");
      expect(route.jobData.collectionType).toBe("comparison");
      expect(route.jobData.plannedItemId).toBe(item.id);
      expect(route.jobData.llmMode).toBe("sync");
    }
  });

  it("routes ki_wissen → article:blog with collectionType=ki-wissen", () => {
    const item = mkItem({ contentType: "ki_wissen" });
    const route = getPipelineForItem(item, "batch");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:blog");
      expect(route.jobData.collectionType).toBe("ki-wissen");
      expect(route.jobData.llmMode).toBe("batch");
    }
  });

  it("routes social_post → article:social-image", () => {
    const item = mkItem({
      contentType: "social_post",
      pipelineInput: { articleId: "art-1", templateKey: "comparison-grid-3" },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:social-image");
      expect(route.jobData.articleId).toBe("art-1");
      expect(route.jobData.templateKey).toBe("comparison-grid-3");
      expect(route.jobData.plannedItemId).toBe(item.id);
    }
  });

  it("propagates llmMode='batch' for batch-discount-eligible pipelines", () => {
    const route = getPipelineForItem(mkItem({ contentType: "comparison" }), "batch");
    if (route.kind === "enqueue") {
      expect(route.jobData.llmMode).toBe("batch");
    }
  });

  it("throws on unknown content_type", () => {
    const item = mkItem({ contentType: "totally_unknown_type" });
    expect(() => getPipelineForItem(item, "sync")).toThrow(/unknown content_type/i);
  });
});
