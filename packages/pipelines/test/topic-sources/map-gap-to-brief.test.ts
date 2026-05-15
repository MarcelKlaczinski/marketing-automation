import { describe, expect, it } from "bun:test";
import type { ContentGap } from "@marketing-auto/db";
import { mapGapToBrief } from "../../src/topic-sources/gap-analysis/map-gap-to-brief.ts";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const GAP_ID     = "00000000-0000-0000-0000-000000000002";
const CLUSTER_ID = "00000000-0000-0000-0000-000000000003";

function makeGap(overrides: Partial<ContentGap>): ContentGap {
  return {
    id:          GAP_ID,
    projectId:   PROJECT_ID,
    clusterId:   CLUSTER_ID,
    gapType:     "missing_hub",
    locale:      null,
    intentType:  null,
    translationKey: null,
    priority:    1,
    status:      "open",
    resolvedAt:  null,
    dismissedAt: null,
    metadata:    { clusterName: "KI-Tools", clusterMemberCount: 3 },
    filledByArticleId:     null,
    filledBySpecId:        null,
    generationTriggeredAt: null,
    detectedAt:  new Date("2026-05-15T00:00:00Z"),
    createdAt:   new Date("2026-05-15T00:00:00Z"),
    updatedAt:   new Date("2026-05-15T00:00:00Z"),
    ...overrides,
  };
}

describe("mapGapToBrief", () => {
  describe("clusterAction mapping", () => {
    it("maps missing_hub → append_to_existing", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_hub" }));
      expect(brief.clusterAction).toBe("append_to_existing");
    });

    it("maps missing_spoke_type → append_to_existing", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_spoke_type", intentType: "faq" }));
      expect(brief.clusterAction).toBe("append_to_existing");
    });

    it("maps missing_translation → translation", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_translation", locale: "en" }));
      expect(brief.clusterAction).toBe("translation");
    });

    it("maps cluster_too_small → append_to_existing", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "cluster_too_small" }));
      expect(brief.clusterAction).toBe("append_to_existing");
    });
  });

  describe("generationMode mapping", () => {
    it("maps missing_hub → pillar", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_hub" }));
      expect(brief.generationMode).toBe("pillar");
    });

    it("maps missing_spoke_type → spoke", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_spoke_type" }));
      expect(brief.generationMode).toBe("spoke");
    });

    it("maps missing_translation → translation", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_translation", locale: "en" }));
      expect(brief.generationMode).toBe("translation");
    });

    it("maps cluster_too_small → spoke", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "cluster_too_small" }));
      expect(brief.generationMode).toBe("spoke");
    });
  });

  describe("topicTitle building", () => {
    it("builds pillar title for missing_hub", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_hub" }));
      expect(brief.topicTitle).toBe('Pillar article for cluster "KI-Tools"');
    });

    it("builds spoke title with intentType for missing_spoke_type", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "missing_spoke_type", intentType: "faq" }));
      expect(brief.topicTitle).toBe('faq article for cluster "KI-Tools"');
    });

    it("builds translate title for missing_translation", () => {
      const gap = makeGap({
        gapType: "missing_translation",
        locale:  "en",
        metadata: { clusterName: "KI-Tools", existingArticleSlug: "beste-ki-tools" },
      });
      const brief = mapGapToBrief(gap);
      expect(brief.topicTitle).toBe('Translate "beste-ki-tools" to en');
    });

    it("builds additional spoke title for cluster_too_small", () => {
      const brief = mapGapToBrief(makeGap({ gapType: "cluster_too_small" }));
      expect(brief.topicTitle).toBe('Additional spoke for cluster "KI-Tools"');
    });

    it("uses 'unknown cluster' when clusterName is missing from metadata", () => {
      const brief = mapGapToBrief(makeGap({ metadata: {} }));
      expect(brief.topicTitle).toContain("unknown cluster");
    });
  });

  describe("metadata carry-over", () => {
    it("carries suggestedCornerstoneKeyword from gap.metadata to primaryKeyword", () => {
      const gap = makeGap({
        metadata: {
          clusterName: "KI-Tools",
          suggestedCornerstoneKeyword: "beste ki tools 2026",
        },
      });
      const brief = mapGapToBrief(gap);
      expect(brief.primaryKeyword).toBe("beste ki tools 2026");
    });

    it("carries discoveredKeywords from gap.metadata to secondaryKeywords", () => {
      const gap = makeGap({
        metadata: {
          clusterName: "KI-Tools",
          discoveredKeywords: ["ai tools list", "best ai software"],
        },
      });
      const brief = mapGapToBrief(gap);
      expect(brief.secondaryKeywords).toEqual(["ai tools list", "best ai software"]);
    });

    it("defaults secondaryKeywords to [] when metadata has none", () => {
      const brief = mapGapToBrief(makeGap({ metadata: {} }));
      expect(brief.secondaryKeywords).toEqual([]);
    });

    it("defaults primaryKeyword to null when not in metadata", () => {
      const brief = mapGapToBrief(makeGap({ metadata: {} }));
      expect(brief.primaryKeyword).toBeNull();
    });
  });

  describe("identity fields", () => {
    it("sets source = gap_analysis", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.source).toBe("gap_analysis");
    });

    it("sets gapId from gap.id", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.gapId).toBe(GAP_ID);
    });

    it("sets projectId from gap.projectId", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.projectId).toBe(PROJECT_ID);
    });

    it("sets clusterId from gap.clusterId", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.clusterId).toBe(CLUSTER_ID);
    });

    it("sets approvalStatus = pending", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.approvalStatus).toBe("pending");
    });

    it("sets approvalRequired = true", () => {
      const brief = mapGapToBrief(makeGap({}));
      expect(brief.approvalRequired).toBe(true);
    });
  });
});
