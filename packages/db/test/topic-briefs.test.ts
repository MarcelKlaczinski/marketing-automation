import { describe, expect, it } from "bun:test";
import { TopicBriefInsertSchema } from "../src/schema/content.ts";

const BASE_GAP_BRIEF = {
  projectId: "00000000-0000-0000-0000-000000000001",
  source: "gap_analysis" as const,
  gapId: "00000000-0000-0000-0000-000000000002",
  topicTitle: "Pillar article for cluster \"KI-Tools\"",
  clusterAction: "append_to_existing" as const,
  gapMetadata: {
    gapType: "missing_hub" as const,
    priority: 1,
    clusterName: "KI-Tools",
  },
};

describe("TopicBriefInsertSchema", () => {
  describe("valid inputs", () => {
    it("accepts a valid gap_analysis brief", () => {
      const result = TopicBriefInsertSchema.safeParse(BASE_GAP_BRIEF);
      expect(result.success).toBe(true);
    });

    it("accepts a valid trend_discovery brief", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "trend_discovery",
        topicTitle: "GPT-5 release coverage",
        clusterAction: "create_new",
        trendMetadata: {
          trendScore: 0.87,
          signals: [
            {
              // `id` was added to the signal schema after this test was written.
              id: "00000000-0000-0000-0000-0000000000a1",
              source: "hackernews",
              externalId: "hN12345",
              capturedAt: "2026-05-15T10:00:00Z",
            },
          ],
          freshnessWindow: "breaking",
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid manual brief with no metadata", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "manual",
        topicTitle: "Hand-crafted topic",
        clusterAction: "standalone",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid refresh_detection brief", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "refresh_detection",
        topicTitle: "Refresh: Best AI Tools 2025",
        clusterAction: "refresh",
        refreshMetadata: {
          targetArticleId: "00000000-0000-0000-0000-000000000099",
          staleness: {
            daysSinceLastUpdate: 180,
            rankingChange: -3,
            competitorRefreshed: true,
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("defaults secondaryKeywords to []", () => {
      const result = TopicBriefInsertSchema.safeParse(BASE_GAP_BRIEF);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.secondaryKeywords).toEqual([]);
      }
    });

    it("defaults approvalStatus to 'pending'", () => {
      const result = TopicBriefInsertSchema.safeParse(BASE_GAP_BRIEF);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.approvalStatus).toBe("pending");
      }
    });
  });

  describe("source/metadata invariants", () => {
    it("rejects gap_analysis brief without gap_metadata", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        gapMetadata: undefined,
      });
      expect(result.success).toBe(false);
    });

    it("rejects gap_analysis brief without gapId", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        gapId: undefined,
      });
      expect(result.success).toBe(false);
    });

    it("rejects trend_discovery brief with gap_id set", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "trend_discovery",
        gapId: "00000000-0000-0000-0000-000000000002",  // must not be set
        topicTitle: "Some trend topic",
        clusterAction: "create_new",
        trendMetadata: {
          trendScore: 0.5,
          signals: [],
          freshnessWindow: "stable",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects manual brief with trend_metadata set", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "manual",
        topicTitle: "Manual topic",
        clusterAction: "standalone",
        trendMetadata: {
          trendScore: 0.5,
          signals: [],
          freshnessWindow: "stable",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects gap_analysis brief with both gap_metadata AND trend_metadata", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        trendMetadata: {
          trendScore: 0.5,
          signals: [],
          freshnessWindow: "stable",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects brief with no metadata when source is not manual", () => {
      const result = TopicBriefInsertSchema.safeParse({
        projectId: "00000000-0000-0000-0000-000000000001",
        source: "refresh_detection",
        topicTitle: "Some refresh",
        clusterAction: "refresh",
        // no refreshMetadata
      });
      expect(result.success).toBe(false);
    });
  });

  describe("field validation", () => {
    it("rejects topicTitle shorter than 3 chars", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        topicTitle: "ab",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid projectId (not a UUID)", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        projectId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid clusterAction value", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        clusterAction: "unknown_action",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid source value", () => {
      const result = TopicBriefInsertSchema.safeParse({
        ...BASE_GAP_BRIEF,
        source: "unknown_source",
      });
      expect(result.success).toBe(false);
    });
  });
});
