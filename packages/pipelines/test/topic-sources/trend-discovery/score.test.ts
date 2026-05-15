import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import {
  computeCommunityBuzz,
  computeOfficialAnnouncementBonus,
  computeCoveragePenalty,
  normalizeGrowthRatio,
  computeSerpVolatilityFromResults,
  computeTrendScore,
} from "../../../src/topic-sources/trend-discovery/score.ts";
import type { ExternalSignal } from "@marketing-auto/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

function makeSignal(overrides: Partial<ExternalSignal> = {}): ExternalSignal {
  return {
    id: crypto.randomUUID(),
    projectId: PROJECT_ID,
    source: "hackernews",
    externalId: `hn-${Math.random()}`,
    title: "Test Signal",
    summary: null,
    url: null,
    author: null,
    publishedAt: new Date(),
    collectedAt: new Date(),
    processedAt: null,
    processedInto: null,
    expiredAt: null,
    rawPayload: {},
    metrics: {},
    ...overrides,
  };
}

function makeTopic(overrides: Partial<{
  topic_title: string;
  primary_keyword: string;
  related_signal_ids: string[];
}> = {}) {
  return {
    topic_title: overrides.topic_title ?? "KI-Tools für Entwickler",
    primary_keyword: overrides.primary_keyword ?? "ki-tools-entwickler",
    secondary_keywords: [],
    intent_type: "overview",
    generation_mode: "timely" as const,
    suggested_title: "Die besten KI-Tools für Entwickler 2026",
    suggested_slug: "ki-tools-entwickler",
    suggested_meta: "Übersicht der besten KI-Tools für Entwickler in 2026 mit Praxis-Tipps.",
    hero_image_prompt: "A developer using multiple AI tools on a modern workstation, digital art style, clean tech aesthetic, blue and purple tones",
    related_signal_ids: overrides.related_signal_ids ?? [],
    freshness_window: "rising" as const,
    relevance_score: 75,
  };
}

// ─── computeCommunityBuzz ─────────────────────────────────────────────────────

describe("computeCommunityBuzz", () => {
  it("returns 0 for empty signal set", () => {
    expect(computeCommunityBuzz([])).toBe(0);
  });

  it("returns 0 when all metrics are zero", () => {
    const signals = [makeSignal({ metrics: { points: 0, votes: 0, comments: 0 } })];
    expect(computeCommunityBuzz(signals)).toBe(0);
  });

  it("returns a positive value for non-zero engagement", () => {
    const signals = [makeSignal({ metrics: { points: 100 } })];
    const result = computeCommunityBuzz(signals);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("sums points + votes + comments across signals", () => {
    const s1 = makeSignal({ metrics: { points: 300 } });
    const s2 = makeSignal({ metrics: { votes: 200, comments: 50 } });
    const combined = computeCommunityBuzz([s1, s2]);
    const singleEquiv = computeCommunityBuzz([makeSignal({ metrics: { points: 550 } })]);
    expect(combined).toBe(singleEquiv);
  });

  it("max engagement (10_000 pts) returns ≤ 100", () => {
    const signals = [makeSignal({ metrics: { points: 10_000 } })];
    expect(computeCommunityBuzz(signals)).toBeLessThanOrEqual(100);
  });
});

// ─── computeOfficialAnnouncementBonus ─────────────────────────────────────────

describe("computeOfficialAnnouncementBonus", () => {
  it("returns 0 when no vendor_rss signals", () => {
    const signals = [makeSignal({ source: "hackernews", url: "https://news.ycombinator.com/1" })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(0);
  });

  it("returns 0 when vendor_rss signal is not a major vendor", () => {
    const signals = [makeSignal({ source: "vendor_rss", url: "https://someblog.com/post" })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(0);
  });

  it("returns 100 when vendor_rss signal is from anthropic.com", () => {
    const signals = [makeSignal({ source: "vendor_rss", url: "https://anthropic.com/news/claude-4" })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(100);
  });

  it("returns 100 when vendor_rss signal is from openai.com", () => {
    const signals = [makeSignal({ source: "vendor_rss", url: "https://openai.com/blog/gpt-5" })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(100);
  });

  it("returns 100 when vendor_rss signal is from huggingface.co", () => {
    const signals = [makeSignal({ source: "vendor_rss", url: "https://huggingface.co/blog/llama3" })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(100);
  });

  it("returns 100 even if only one of multiple signals is official", () => {
    const signals = [
      makeSignal({ source: "hackernews", url: "https://hn.com/1" }),
      makeSignal({ source: "vendor_rss", url: "https://anthropic.com/blog/x" }),
    ];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(100);
  });

  it("returns 0 for vendor_rss with null url", () => {
    const signals = [makeSignal({ source: "vendor_rss", url: null })];
    expect(computeOfficialAnnouncementBonus(signals)).toBe(0);
  });
});

// ─── normalizeGrowthRatio ─────────────────────────────────────────────────────

describe("normalizeGrowthRatio", () => {
  it("returns 0 for null (DataForSEO unavailable)", () => {
    expect(normalizeGrowthRatio(null)).toBe(0);
  });

  it("returns 0 for negative growth", () => {
    expect(normalizeGrowthRatio(-0.5)).toBe(0);
  });

  it("returns 50 for 100% growth (ratio=1)", () => {
    expect(normalizeGrowthRatio(1.0)).toBe(50);
  });

  it("returns 100 for 200%+ growth (ratio=2)", () => {
    expect(normalizeGrowthRatio(2.0)).toBe(100);
    expect(normalizeGrowthRatio(5.0)).toBe(100); // clamped
  });

  it("returns 0 for ratio=0", () => {
    expect(normalizeGrowthRatio(0)).toBe(0);
  });
});

// ─── computeCoveragePenalty ───────────────────────────────────────────────────

describe("computeCoveragePenalty", () => {
  it("returns 100 for similarity >= 0.85 (definitely covered)", () => {
    expect(computeCoveragePenalty(0.85)).toBe(100);
    expect(computeCoveragePenalty(0.95)).toBe(100);
    expect(computeCoveragePenalty(1.0)).toBe(100);
  });

  it("returns 0 for similarity <= 0.50 (definitely new)", () => {
    expect(computeCoveragePenalty(0.50)).toBe(0);
    expect(computeCoveragePenalty(0.3)).toBe(0);
    expect(computeCoveragePenalty(0)).toBe(0);
  });

  it("returns intermediate value in the 0.50-0.85 band", () => {
    const mid = computeCoveragePenalty(0.675); // midpoint
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    // linear: (0.675 - 0.50) / (0.85 - 0.50) = 0.5 → 50
    expect(mid).toBe(50);
  });

  it("penalty increases monotonically with similarity", () => {
    const p60 = computeCoveragePenalty(0.60);
    const p70 = computeCoveragePenalty(0.70);
    const p80 = computeCoveragePenalty(0.80);
    expect(p60).toBeLessThan(p70);
    expect(p70).toBeLessThan(p80);
  });
});

// ─── computeSerpVolatilityFromResults ─────────────────────────────────────────

describe("computeSerpVolatilityFromResults", () => {
  it("returns 0 for no SERP features and many organic results", () => {
    const result = computeSerpVolatilityFromResults([], 10);
    expect(result).toBeLessThan(30);
  });

  it("returns higher value for many SERP features", () => {
    const few = computeSerpVolatilityFromResults([], 10);
    const many = computeSerpVolatilityFromResults(["featured_snippet", "people_also_ask", "shopping", "images", "news"], 8);
    expect(many).toBeGreaterThan(few);
  });

  it("returns 0-100 range always", () => {
    const result = computeSerpVolatilityFromResults(["x", "y", "z", "a", "b", "c"], 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

// ─── computeTrendScore (integration, mocked DataForSEO) ───────────────────────

describe("computeTrendScore (with mocked DataForSEO)", () => {
  let originalTrendsExplore: unknown;
  let originalSerp: unknown;

  // Dynamically import so we can mock the module exports
  beforeEach(async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    originalTrendsExplore = dfs.dataforseo.trendsExplore;
    originalSerp = dfs.dataforseo.serp;
  });

  afterEach(async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    dfs.dataforseo.trendsExplore = originalTrendsExplore as typeof dfs.dataforseo.trendsExplore;
    dfs.dataforseo.serp = originalSerp as typeof dfs.dataforseo.serp;
  });

  it("all components zero → total = 0", async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    dfs.dataforseo.trendsExplore = mock(async () => [{ keyword: "x", growth_ratio: null, current_volume: null, prev_year_volume: null }]);
    dfs.dataforseo.serp = mock(async () => ({ keyword: "x", totalResults: 0, serpFeatures: [], organicResults: [], peopleAlsoAsk: [], relatedSearches: [], checkUrl: "" }));

    const result = await computeTrendScore({
      projectId: PROJECT_ID,
      candidate: makeTopic({ related_signal_ids: [] }),
      signalPool: [],
      maxExistingSimilarity: 0, // no coverage penalty
    });

    expect(result.community_buzz).toBe(0);
    expect(result.search_volume_growth).toBe(0);
    expect(result.official_announcement).toBe(0);
    expect(result.serp_volatility).toBe(0);
    expect(result.existing_coverage_penalty).toBe(0);
    expect(result.total).toBe(0);
  });

  it("max positive components, zero penalty → total ≤ 90 (sum of weights w/o coverage)", async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    // growth ratio 2.0 → normalized 100
    dfs.dataforseo.trendsExplore = mock(async () => [{ keyword: "x", growth_ratio: 2.0, current_volume: 5000, prev_year_volume: 1000 }]);
    // many serp features → high volatility
    dfs.dataforseo.serp = mock(async () => ({
      keyword: "x",
      totalResults: 0,
      serpFeatures: ["featured_snippet", "people_also_ask", "shopping", "images", "news"],
      organicResults: [],
      peopleAlsoAsk: [],
      relatedSearches: [],
      checkUrl: "",
    }));

    const signalId = crypto.randomUUID();
    const signal = makeSignal({
      id: signalId,
      source: "vendor_rss",
      url: "https://anthropic.com/blog/major-release",
      metrics: { points: 5000 },
    });

    const result = await computeTrendScore({
      projectId: PROJECT_ID,
      candidate: makeTopic({ related_signal_ids: [signalId] }),
      signalPool: [signal],
      maxExistingSimilarity: 0,
    });

    // Max without coverage: w_buzz(30) + w_growth(25) + w_official(15) + w_serp(20) = 90
    expect(result.total).toBeLessThanOrEqual(90);
    expect(result.official_announcement).toBe(100);
    expect(result.existing_coverage_penalty).toBe(0);
  });

  it("max positive, max coverage penalty → total ≤ 50", async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    dfs.dataforseo.trendsExplore = mock(async () => [{ keyword: "x", growth_ratio: 2.0, current_volume: 5000, prev_year_volume: 1000 }]);
    dfs.dataforseo.serp = mock(async () => ({
      keyword: "x", totalResults: 0, serpFeatures: ["featured_snippet", "people_also_ask", "shopping", "images", "news"],
      organicResults: [], peopleAlsoAsk: [], relatedSearches: [], checkUrl: "",
    }));

    const signalId = crypto.randomUUID();
    const signal = makeSignal({
      id: signalId,
      source: "vendor_rss",
      url: "https://anthropic.com/blog/release",
      metrics: { points: 5000 },
    });

    const result = await computeTrendScore({
      projectId: PROJECT_ID,
      candidate: makeTopic({ related_signal_ids: [signalId] }),
      signalPool: [signal],
      maxExistingSimilarity: 0.9, // → penalty 100
    });

    // max positive ≤ 90, penalty = 40 → total ≤ 90 - 40 = 50
    expect(result.existing_coverage_penalty).toBe(100);
    expect(result.total).toBeLessThanOrEqual(50);
  });

  it("DataForSEO failure → growth = 0, no crash", async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    dfs.dataforseo.trendsExplore = mock(async () => { throw new Error("API down"); });
    dfs.dataforseo.serp = mock(async () => { throw new Error("SERP down"); });

    const result = await computeTrendScore({
      projectId: PROJECT_ID,
      candidate: makeTopic({ related_signal_ids: [] }),
      signalPool: [],
      maxExistingSimilarity: 0,
    });

    expect(result.search_volume_growth).toBe(0);
    expect(result.serp_volatility).toBe(0);
    expect(result.total).toBe(0);
  });

  it("single official announcement: contributes w_official (15) to total", async () => {
    const dfs = await import("@marketing-auto/adapter-dataforseo");
    dfs.dataforseo.trendsExplore = mock(async () => [{ keyword: "x", growth_ratio: null, current_volume: null, prev_year_volume: null }]);
    dfs.dataforseo.serp = mock(async () => ({ keyword: "x", totalResults: 0, serpFeatures: [], organicResults: [], peopleAlsoAsk: [], relatedSearches: [], checkUrl: "" }));

    const signalId = crypto.randomUUID();
    const signal = makeSignal({
      id: signalId,
      source: "vendor_rss",
      url: "https://openai.com/blog/release",
      metrics: {},
    });

    const result = await computeTrendScore({
      projectId: PROJECT_ID,
      candidate: makeTopic({ related_signal_ids: [signalId] }),
      signalPool: [signal],
      maxExistingSimilarity: 0,
    });

    // Only official announcement contributes: (15 * 100) / 100 = 15
    expect(result.official_announcement).toBe(100);
    expect(result.total).toBe(15);
  });
});
