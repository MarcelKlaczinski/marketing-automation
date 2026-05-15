import { describe, expect, it } from "bun:test";
import type { ContentGap } from "@marketing-auto/db";
import { GapAnalysisTopicSource } from "../../src/topic-sources/gap-analysis/source.ts";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const GAP_ID_1   = "00000000-0000-0000-0000-000000000010";
const GAP_ID_2   = "00000000-0000-0000-0000-000000000011";
const CLUSTER_ID = "00000000-0000-0000-0000-000000000003";

function makeGap(id: string, status: ContentGap["status"], gapType: ContentGap["gapType"] = "missing_hub"): ContentGap {
  return {
    id,
    projectId:   PROJECT_ID,
    clusterId:   CLUSTER_ID,
    gapType,
    locale:      null,
    intentType:  null,
    translationKey: null,
    priority:    1,
    status,
    resolvedAt:  null,
    dismissedAt: null,
    metadata:    { clusterName: "Test Cluster" },
    filledByArticleId:     null,
    filledBySpecId:        null,
    generationTriggeredAt: null,
    detectedAt:  new Date("2026-05-15T00:00:00Z"),
    createdAt:   new Date("2026-05-15T00:00:00Z"),
    updatedAt:   new Date("2026-05-15T00:00:00Z"),
  };
}

const ctx = { projectId: PROJECT_ID };

describe("GapAnalysisTopicSource", () => {
  const source = new GapAnalysisTopicSource();

  it("has source = gap_analysis", () => {
    expect(source.source).toBe("gap_analysis");
  });

  it("returns empty array for empty input", async () => {
    const briefs = await source.emit({ gaps: [] }, ctx);
    expect(briefs).toEqual([]);
  });

  it("returns a brief for each open gap", async () => {
    const gaps = [makeGap(GAP_ID_1, "open"), makeGap(GAP_ID_2, "open")];
    const briefs = await source.emit({ gaps }, ctx);
    expect(briefs).toHaveLength(2);
  });

  it("returns a brief for in_progress gaps", async () => {
    const gaps = [makeGap(GAP_ID_1, "in_progress")];
    const briefs = await source.emit({ gaps }, ctx);
    expect(briefs).toHaveLength(1);
  });

  it("filters out resolved gaps", async () => {
    const gaps = [
      makeGap(GAP_ID_1, "open"),
      makeGap(GAP_ID_2, "resolved"),
    ];
    const briefs = await source.emit({ gaps }, ctx);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.gapId).toBe(GAP_ID_1);
  });

  it("filters out dismissed gaps", async () => {
    const gaps = [makeGap(GAP_ID_1, "dismissed")];
    const briefs = await source.emit({ gaps }, ctx);
    expect(briefs).toHaveLength(0);
  });

  it("filters out all non-eligible gaps when none are open", async () => {
    const gaps = [
      makeGap(GAP_ID_1, "resolved"),
      makeGap(GAP_ID_2, "dismissed"),
    ];
    const briefs = await source.emit({ gaps }, ctx);
    expect(briefs).toHaveLength(0);
  });

  it("produces briefs linked to the correct gap ids", async () => {
    const gaps = [makeGap(GAP_ID_1, "open"), makeGap(GAP_ID_2, "in_progress")];
    const briefs = await source.emit({ gaps }, ctx);
    const gapIds = briefs.map((b) => b.gapId);
    expect(gapIds).toContain(GAP_ID_1);
    expect(gapIds).toContain(GAP_ID_2);
  });
});
