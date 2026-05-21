import { describe, expect, it } from "bun:test";
import type { TopicBrief } from "@marketing-auto/db";
import { decideRoute } from "../../src/routing/decide-route.ts";

// Minimal TopicBrief factory — only fields decideRoute actually reads
function makeBrief(overrides: Partial<TopicBrief> = {}): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    source: "gap_analysis",
    gapId: crypto.randomUUID(),
    topicTitle: "Test topic",
    primaryKeyword: "test keyword",
    secondaryKeywords: [],
    locale: "de",
    intentType: null,
    clusterId: crypto.randomUUID(),
    clusterAction: "append_to_existing",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TopicBrief;
}

describe("decideRoute", () => {
  describe("non-gap_analysis sources", () => {
    it("returns skip for trend_discovery", () => {
      const brief = makeBrief({ source: "trend_discovery", gapMetadata: null });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("trend_discovery");
    });

    it("returns skip for manual", () => {
      const brief = makeBrief({ source: "manual" });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
    });
  });

  describe("gap_analysis with missing gapMetadata", () => {
    it("returns skip when gapMetadata is null", () => {
      const brief = makeBrief({ gapMetadata: null });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("gap_metadata");
    });
  });

  describe("missing_hub", () => {
    it("returns create_cornerstone_spec for missing_hub with clusterId", () => {
      const clusterId = crypto.randomUUID();
      const brief = makeBrief({
        clusterId,
        gapMetadata: { gapType: "missing_hub", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("create_cornerstone_spec");
      if (d.kind === "create_cornerstone_spec") {
        expect(d.clusterId).toBe(clusterId);
        expect(d.mode).toBe("pillar");
      }
    });

    it("returns skip for missing_hub without clusterId", () => {
      const brief = makeBrief({
        clusterId: null,
        gapMetadata: { gapType: "missing_hub", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("clusterId");
    });
  });

  describe("missing_spoke_type", () => {
    it("returns create_article with intentType from brief", () => {
      const clusterId = crypto.randomUUID();
      const brief = makeBrief({
        clusterId,
        intentType: "how_to",
        gapMetadata: { gapType: "missing_spoke_type", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("create_article");
      if (d.kind === "create_article") {
        expect(d.clusterId).toBe(clusterId);
        expect(d.intentType).toBe("how_to");
        expect(d.mode).toBe("spoke");
      }
    });

    it("returns skip when intentType is null", () => {
      const brief = makeBrief({
        intentType: null,
        gapMetadata: { gapType: "missing_spoke_type", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("intentType");
    });

    it("returns skip without clusterId", () => {
      const brief = makeBrief({
        clusterId: null,
        intentType: "how_to",
        gapMetadata: { gapType: "missing_spoke_type", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
    });
  });

  describe("cluster_too_small", () => {
    it("returns create_article with use_case default when intentType null", () => {
      const clusterId = crypto.randomUUID();
      const brief = makeBrief({
        clusterId,
        intentType: null,
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("create_article");
      if (d.kind === "create_article") {
        expect(d.intentType).toBe("use_case");
      }
    });

    it("uses generationMode from brief when set", () => {
      const clusterId = crypto.randomUUID();
      const brief = makeBrief({
        clusterId,
        intentType: "how_to",
        generationMode: "evergreen",
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("create_article");
      if (d.kind === "create_article") {
        expect(d.mode).toBe("evergreen");
      }
    });
  });

  describe("missing_translation", () => {
    it("returns create_translation with correct fields", () => {
      const translationKey = "article-abc-123";
      const brief = makeBrief({
        locale: "de",
        gapMetadata: {
          gapType: "missing_translation",
          priority: 2,
          translationKey,
          existingLocale: "en",
        },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("create_translation");
      if (d.kind === "create_translation") {
        expect(d.sourceTranslationKey).toBe(translationKey);
        expect(d.targetLocale).toBe("de");
      }
    });

    it("returns skip when translationKey is missing", () => {
      const brief = makeBrief({
        locale: "de",
        gapMetadata: {
          gapType: "missing_translation",
          priority: 2,
          existingLocale: "en",
        },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("translationKey");
    });

    it("returns skip when locale is null", () => {
      const brief = makeBrief({
        locale: null,
        gapMetadata: {
          gapType: "missing_translation",
          priority: 2,
          translationKey: "article-abc-123",
          existingLocale: "de",
        },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
    });
  });

  describe("unknown gapType", () => {
    it("returns skip for unknown gap type", () => {
      const brief = makeBrief({
        gapMetadata: { gapType: "completely_unknown_type" as never, priority: 1 },
      });
      const d = decideRoute(brief);
      expect(d.kind).toBe("skip");
      expect((d as { reason: string }).reason).toContain("Unknown gapType");
    });
  });
});
