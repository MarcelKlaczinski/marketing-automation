// Spec 63.5: unit tests for the iterative diversity-aware picker.
// Embedding provider is stubbed — no DB, no Voyage calls.

import { describe, expect, it } from "bun:test";
import type { TopicBrief } from "@marketing-auto/db";
import {
  normalizeBriefBaseScore,
  pickWithDiversity,
} from "../../../src/planning/lib/pick-with-diversity.ts";
import type { EmbeddingProvider } from "../../../src/planning/lib/diversity-embedding.ts";

const projectId = "00000000-0000-0000-0000-0000000000d5";

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

/** Provider stub that returns a pre-baked vector per brief.id. */
function stubProvider(map: Map<string, number[] | null>): EmbeddingProvider<TopicBrief> {
  return {
    async getForItem(b) {
      return map.has(b.id) ? (map.get(b.id) ?? null) : null;
    },
  };
}

const cfg = { threshold: 0.5, malusWeight: 0.5 };

describe("pickWithDiversity", () => {
  it("picks diverse briefs over near-duplicates of higher base score", () => {
    // Three near-duplicates of cat A + one different cat B. target=2 should
    // yield 1 of cat A (the top scorer) + the cat B brief — NOT two cat A's.
    const a1 = brief({ topicTitle: "OpenAI Codex 1" });
    const a2 = brief({ topicTitle: "OpenAI Codex 2" });
    const a3 = brief({ topicTitle: "OpenAI Codex 3" });
    const b = brief({ topicTitle: "RAG with Claude" });

    const provider = stubProvider(
      new Map<string, number[] | null>([
        [a1.id, [1, 0]],
        [a2.id, [1, 0.1]], // very similar to a1
        [a3.id, [0.95, 0.1]], // very similar to a1
        [b.id, [0, 1]], // orthogonal
      ]),
    );
    // a1 has the highest base score; a2/a3 slightly lower; b lowest in pool order.
    const baseScores = new Map<string, number>([
      [a1.id, 0.9],
      [a2.id, 0.85],
      [a3.id, 0.8],
      [b.id, 0.6],
    ]);

    const result = (async () =>
      await pickWithDiversity({
        pool: [a1, a2, a3, b],
        target: 2,
        embeddingProvider: provider,
        config: cfg,
        getBaseScore: (br) => baseScores.get(br.id) ?? 0,
        getItemId: (br) => br.id,
      }))();

    return result.then((r) => {
      expect(r.picked).toHaveLength(2);
      expect(r.picked[0]?.id).toBe(a1.id); // top scorer first (empty picked set)
      expect(r.picked[1]?.id).toBe(b.id); // diverse pick beats a2/a3 despite lower base
      // a2/a3 should have non-trivial malus in second-round audit if we re-ran;
      // verifying we didn't grab them is the contract.
    });
  });

  it("picks both near-duplicates when no diverse alternative exists (target=pool)", async () => {
    const a1 = brief();
    const a2 = brief();
    const provider = stubProvider(
      new Map<string, number[] | null>([
        [a1.id, [1, 0]],
        [a2.id, [1, 0]],
      ]),
    );
    const r = await pickWithDiversity({
      pool: [a1, a2],
      target: 2,
      embeddingProvider: provider,
      config: cfg,
      getBaseScore: () => 0.8,
      getItemId: (br) => br.id,
    });
    expect(r.picked).toHaveLength(2);
    expect(new Set(r.picked.map((b) => b.id))).toEqual(new Set([a1.id, a2.id]));
    // Second pick has the larger malus annotation.
    expect(r.reasons[1]?.malus).toBeGreaterThan(0);
  });

  it("falls back to FIFO when provider returns null for everyone", async () => {
    const a = brief({ topicTitle: "A" });
    const b = brief({ topicTitle: "B" });
    const c = brief({ topicTitle: "C" });
    const provider = stubProvider(new Map<string, number[] | null>());
    // All embeddings null → no malus for anyone → pure base-score sort.
    const r = await pickWithDiversity({
      pool: [a, b, c],
      target: 2,
      embeddingProvider: provider,
      config: cfg,
      getBaseScore: (br) => (br.id === c.id ? 0.95 : br.id === b.id ? 0.8 : 0.5),
      getItemId: (br) => br.id,
    });
    expect(r.picked.map((br) => br.id)).toEqual([c.id, b.id]);
    expect(r.reasons.every((reason) => reason.malus === 0)).toBe(true);
  });

  it("malusWeight=0 disables diversity entirely (top-N by base score)", async () => {
    const a1 = brief();
    const a2 = brief();
    const b = brief();
    const provider = stubProvider(
      new Map<string, number[] | null>([
        [a1.id, [1, 0]],
        [a2.id, [1, 0]], // identical → would normally trigger malus
        [b.id, [0, 1]],
      ]),
    );
    const r = await pickWithDiversity({
      pool: [a1, a2, b],
      target: 2,
      embeddingProvider: provider,
      config: { threshold: 0.5, malusWeight: 0 },
      getBaseScore: (br) => (br.id === a1.id ? 0.9 : br.id === a2.id ? 0.85 : 0.5),
      getItemId: (br) => br.id,
    });
    // With diversity off, top-2 base = [a1, a2] (b's lower base wins out via diversity, but malus is 0).
    expect(r.picked.map((br) => br.id)).toEqual([a1.id, a2.id]);
  });

  it("threshold=1 disables diversity (same as malusWeight=0)", async () => {
    const a1 = brief();
    const a2 = brief();
    const provider = stubProvider(
      new Map<string, number[] | null>([
        [a1.id, [1, 0]],
        [a2.id, [1, 0]],
      ]),
    );
    const r = await pickWithDiversity({
      pool: [a1, a2],
      target: 2,
      embeddingProvider: provider,
      config: { threshold: 1, malusWeight: 0.5 },
      getBaseScore: () => 0.8,
      getItemId: (br) => br.id,
    });
    expect(r.reasons.every((reason) => reason.malus === 0)).toBe(true);
  });

  it("respects initialPickedEmbeddings (Overage inherits Floor diversity)", async () => {
    // Floor picked something with vector [1,0]. Overage pool has a near-dup
    // and a diverse one — initialPickedEmbeddings must penalise the dup.
    const dup = brief({ topicTitle: "near-dup of floor" });
    const diverse = brief({ topicTitle: "diverse" });
    const provider = stubProvider(
      new Map<string, number[] | null>([
        [dup.id, [1, 0]],
        [diverse.id, [0, 1]],
      ]),
    );
    const r = await pickWithDiversity({
      pool: [dup, diverse],
      target: 1,
      embeddingProvider: provider,
      config: cfg,
      // dup has higher base score but should lose due to floor-malus.
      getBaseScore: (br) => (br.id === dup.id ? 0.9 : 0.6),
      getItemId: (br) => br.id,
      initialPickedEmbeddings: [[1, 0]],
    });
    expect(r.picked).toHaveLength(1);
    expect(r.picked[0]?.id).toBe(diverse.id);
  });

  it("never picks more than target, even with a larger pool", async () => {
    const briefs = Array.from({ length: 5 }, (_, i) => brief({ topicTitle: `b${i}` }));
    const provider = stubProvider(new Map());
    const r = await pickWithDiversity({
      pool: briefs,
      target: 3,
      embeddingProvider: provider,
      config: cfg,
      getBaseScore: () => 0.5,
      getItemId: (br) => br.id,
    });
    expect(r.picked).toHaveLength(3);
    expect(r.reasons).toHaveLength(3);
  });

  it("caps target at pool.length when pool is smaller", async () => {
    const briefs = [brief(), brief()];
    const provider = stubProvider(new Map());
    const r = await pickWithDiversity({
      pool: briefs,
      target: 10,
      embeddingProvider: provider,
      config: cfg,
      getBaseScore: () => 0.5,
      getItemId: (br) => br.id,
    });
    expect(r.picked).toHaveLength(2);
  });

  it("audit reason text mentions malus when one was applied", async () => {
    const a1 = brief();
    const a2 = brief();
    const provider = stubProvider(
      new Map<string, number[] | null>([
        [a1.id, [1, 0]],
        [a2.id, [1, 0]],
      ]),
    );
    const r = await pickWithDiversity({
      pool: [a1, a2],
      target: 2,
      embeddingProvider: provider,
      config: cfg,
      getBaseScore: () => 0.8,
      getItemId: (br) => br.id,
    });
    expect(r.reasons[0]?.reason).toContain("no diversity malus");
    expect(r.reasons[1]?.reason).toContain("malus=");
    expect(r.reasons[1]?.reason).toContain("sim=");
  });
});

describe("normalizeBriefBaseScore", () => {
  it("maps trend_discovery.trendScore from [0,100] to [0,1]", () => {
    const b = brief({
      source: "trend_discovery",
      trendMetadata: {
        trendScore: 80,
        signals: [],
        freshnessWindow: "rising",
      },
    });
    expect(normalizeBriefBaseScore(b, 0, 10)).toBeCloseTo(0.8, 5);
  });

  it("uses comparison_discovery.score directly (already 0..1)", () => {
    const b = brief({
      source: "comparison_discovery",
      comparisonMetadata: {
        toolASlug: "a",
        toolBSlug: "b",
        toolAName: "A",
        toolBName: "B",
        coMentionCount: 3,
        coMentionArticleIds: [],
        score: 0.65,
        categoryOverlap: true,
        recencyBoost: 0.3,
        reason: "test",
      },
    });
    expect(normalizeBriefBaseScore(b, 5, 10)).toBeCloseTo(0.65, 5);
  });

  it("falls back to FIFO surrogate for gap_analysis briefs", () => {
    const b = brief({ source: "gap_analysis" });
    // i=0, n=10 → 1 - 0/10 = 1.0
    expect(normalizeBriefBaseScore(b, 0, 10)).toBeCloseTo(1.0, 5);
    // i=9, n=10 → 1 - 9/10 = 0.1
    expect(normalizeBriefBaseScore(b, 9, 10)).toBeCloseTo(0.1, 5);
  });

  it("falls back to FIFO when trendMetadata is missing", () => {
    const b = brief({ source: "trend_discovery", trendMetadata: null });
    expect(normalizeBriefBaseScore(b, 2, 10)).toBeCloseTo(0.8, 5);
  });

  it("returns 1 when poolLength <= 1 (avoid divide-by-zero / inverted scoring)", () => {
    const b = brief();
    expect(normalizeBriefBaseScore(b, 0, 1)).toBe(1);
    expect(normalizeBriefBaseScore(b, 0, 0)).toBe(1);
  });

  it("clamps trend scores above 100 to 1", () => {
    const b = brief({
      source: "trend_discovery",
      trendMetadata: {
        trendScore: 150,
        signals: [],
        freshnessWindow: "breaking",
      },
    });
    expect(normalizeBriefBaseScore(b, 0, 10)).toBe(1);
  });
});
