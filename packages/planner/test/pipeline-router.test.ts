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
  it("routes cluster items to the inline cluster:full-plan path", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: { briefId: "brief-99", projectId: "proj-1", title: "AI Coding" },
    });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("inline");
    if (route.kind === "inline") {
      expect(route.action).toBe("cluster:full-plan");
      expect(route.briefId).toBe("brief-99");
    }
  });

  it("throws when a cluster item has no briefId", () => {
    const item = mkItem({
      contentType: "cluster",
      pipelineInput: { projectId: "proj-1" },
    });
    expect(() => getPipelineForItem(item, "sync")).toThrow(/missing/);
  });

  it("routes comparison → article:blog with collectionType=comparisons", () => {
    const item = mkItem({ contentType: "comparison" });
    const route = getPipelineForItem(item, "sync");
    expect(route.kind).toBe("enqueue");
    if (route.kind === "enqueue") {
      expect(route.pipelineName).toBe("article:blog");
      expect(route.jobData.collectionType).toBe("comparisons");
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
