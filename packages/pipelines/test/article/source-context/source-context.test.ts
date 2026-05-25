import { describe, expect, it } from "bun:test";
import { buildSourceContextFragment } from "../../../src/article/source-context/index.ts";
import type { TopicBrief, GapMetadata, TrendMetadata } from "@marketing-auto/db";

// Minimal stub that satisfies the fields accessed by buildSourceContextFragment
function makeBrief(
  source: TopicBrief["source"],
  overrides: Partial<Pick<TopicBrief, "gapMetadata" | "trendMetadata">> = {},
): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    source,
    topicTitle: "Test Topic",
    primaryKeyword: null,
    secondaryKeywords: [],
    locale: "de",
    intentType: null,
    clusterId: null,
    clusterAction: "standalone",
    approvalRequired: true,
    approvalStatus: "approved",
    gapId: null,
    searchVolumeDe: null,
    searchVolumeEn: null,
    difficulty: null,
    serpSnapshot: null,
    suggestedTitle: null,
    suggestedSlug: null,
    suggestedMeta: null,
    heroImagePrompt: null,
    generationMode: null,
    approvedBy: null,
    approvedAt: null,
    gapMetadata: null,
    trendMetadata: null,
    refreshMetadata: null,
    comparisonMetadata: null,
    releaseMetadata: null,
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

const GAP_METADATA: GapMetadata = {
  gapType: "missing_spoke_type",
  priority: 2,
  clusterName: "ChatGPT Alternativen 2026",
  spokesPresent: ["best-chatgpt-alternatives.mdx", "claude-vs-chatgpt.mdx"],
  suggestedCornerstoneKeyword: "chatgpt alternatives free",
  clusterMemberCount: 3,
};

const TREND_METADATA: TrendMetadata = {
  trendScore: 78,
  signals: [
    {
      id: crypto.randomUUID(),
      source: "producthunt",
      externalId: "ph-1",
      capturedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      source: "hackernews",
      externalId: "hn-1",
      capturedAt: new Date().toISOString(),
    },
  ],
  freshnessWindow: "rising",
  relatedEvent: "GPT-5 launch",
};

// ─── gap_analysis source ──────────────────────────────────────────────────────

describe("buildSourceContextFragment — gap_analysis", () => {
  it("includes cluster name", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: GAP_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("ChatGPT Alternativen 2026");
  });

  it("includes gap type", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: GAP_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("missing_spoke_type");
  });

  it("includes existing spokes when present", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: GAP_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("best-chatgpt-alternatives.mdx");
    expect(fragment).toContain("claude-vs-chatgpt.mdx");
    expect(fragment).toContain("complement");
  });

  it("includes suggested cornerstone keyword", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: GAP_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("chatgpt alternatives free");
  });

  it("returns non-empty string", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: GAP_METADATA });
    expect(buildSourceContextFragment(brief)).not.toBe("");
  });

  it("returns empty string when gapMetadata is null", () => {
    const brief = makeBrief("gap_analysis", { gapMetadata: null });
    expect(buildSourceContextFragment(brief)).toBe("");
  });

  it("omits spokes section when spokesPresent is empty", () => {
    const gap: GapMetadata = { ...GAP_METADATA, spokesPresent: [] };
    const brief = makeBrief("gap_analysis", { gapMetadata: gap });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).not.toContain("complement");
  });
});

// ─── trend_discovery source ───────────────────────────────────────────────────

describe("buildSourceContextFragment — trend_discovery", () => {
  it("includes trend score", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: TREND_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("78");
  });

  it("includes freshness window", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: TREND_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("rising");
  });

  it("includes distinct signal sources", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: TREND_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("producthunt");
    expect(fragment).toContain("hackernews");
  });

  it("includes related event when set", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: TREND_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("GPT-5 launch");
  });

  it("includes timely-angle instruction", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: TREND_METADATA });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("timely angle");
  });

  it("omits related event line when not set", () => {
    const trend: TrendMetadata = { ...TREND_METADATA, relatedEvent: undefined };
    const brief = makeBrief("trend_discovery", { trendMetadata: trend });
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).not.toContain("Related event");
  });

  it("deduplicates signal sources", () => {
    const trend: TrendMetadata = {
      ...TREND_METADATA,
      signals: [
        { id: crypto.randomUUID(), source: "producthunt", externalId: "a", capturedAt: new Date().toISOString() },
        { id: crypto.randomUUID(), source: "producthunt", externalId: "b", capturedAt: new Date().toISOString() },
      ],
    };
    const brief = makeBrief("trend_discovery", { trendMetadata: trend });
    const fragment = buildSourceContextFragment(brief);
    // Should only mention producthunt once in the sources list
    const matches = fragment.match(/producthunt/g);
    expect(matches).toHaveLength(1);
  });

  it("returns empty string when trendMetadata is null", () => {
    const brief = makeBrief("trend_discovery", { trendMetadata: null });
    expect(buildSourceContextFragment(brief)).toBe("");
  });
});

// ─── manual source ────────────────────────────────────────────────────────────

describe("buildSourceContextFragment — manual", () => {
  it("returns empty string", () => {
    const brief = makeBrief("manual");
    expect(buildSourceContextFragment(brief)).toBe("");
  });
});

// ─── refresh_detection source ─────────────────────────────────────────────────

describe("buildSourceContextFragment — refresh_detection", () => {
  // Spec 54.10 added refresh_detection support (the test was written for 54.9 when it
  // wasn't yet implemented). The fragment now returns refresh framing text.
  it("returns refresh framing text including 'Refresh Context'", () => {
    const brief = makeBrief("refresh_detection");
    const fragment = buildSourceContextFragment(brief);
    expect(fragment).toContain("Refresh Context");
    expect(fragment).toContain("refresh of an existing article");
  });
});
