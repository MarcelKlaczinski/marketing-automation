import {
  createLogger,
  resolveTrendScoreWeights,
  type TrendScoreWeights,
} from "@marketing-auto/shared";
import { dataforseo } from "@marketing-auto/adapter-dataforseo";
import type { ExternalSignal } from "@marketing-auto/db";
import { MAJOR_VENDOR_DOMAINS, type ScoreBreakdown, type SynthesisTopic } from "./types.ts";

const log = createLogger("trend-discovery:score");

// ─── Weights (spec 54.5b rebalanced constants; Spec 64.19 / Phase D made per-project) ───
// buzz+growth halved to reduce RSS signal bias; diversity added (cross-source validation);
// official raised (vendor announcements are legitimate trend signals).
// Positive weights sum to 100: 15+15+25+20+25 = 100.
//
// Per-project overrides live in `project_planner_config.trend_score_weights` JSONB
// (migration 0104). Resolved via `resolveTrendScoreWeights(override)` from
// `@marketing-auto/shared`. The default constant `DEFAULT_TREND_SCORE_WEIGHTS` lives
// in `shared/project-config.ts` so the API + UI + score function read the same source.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Community buzz score (0-100).
 * log10(totalEngagement + 1) normalised to a practical max of log10(10_000+1) ≈ 4.
 * Returns 0 for empty signal sets.
 */
export function computeCommunityBuzz(signals: ExternalSignal[]): number {
  if (signals.length === 0) return 0;

  let total = 0;
  for (const s of signals) {
    const m = s.metrics as Record<string, number | undefined>;
    total += (m["points"] ?? 0) + (m["votes"] ?? 0) + (m["comments"] ?? 0);
  }
  if (total === 0) return 0;

  // log10 normalised: log10(10_000) ≈ 4 → 100
  const normalized = Math.log10(total + 1) / Math.log10(10_001);
  return Math.round(clamp(normalized * 100, 0, 100));
}

/**
 * Official announcement bonus (0 or 100).
 * Returns 100 if any candidate signal is a vendor_rss item from a major lab.
 */
export function computeOfficialAnnouncementBonus(signals: ExternalSignal[]): number {
  for (const s of signals) {
    if (s.source !== "vendor_rss") continue;
    if (!s.url) continue;

    try {
      const hostname = new URL(s.url).hostname.replace(/^www\./, "");
      if (MAJOR_VENDOR_DOMAINS.has(hostname)) return 100;
    } catch {
      // invalid URL — skip
    }
  }
  return 0;
}

/**
 * Normalise a DataForSEO Trends growth_ratio to 0-100.
 * growth_ratio = (current - prev) / prev.
 * Cap at ±2 (200% growth or −100% decline) for the normalisation range.
 * Negative growth → 0.
 */
export function normalizeGrowthRatio(ratio: number | null): number {
  if (ratio === null) return 0;
  // Clamp to [0, 2] — >200% is treated as max, negative as 0
  const clamped = clamp(ratio, 0, 2);
  return Math.round((clamped / 2) * 100);
}

/**
 * Compute SERP volatility: how many new domains appear in top 10 vs 30 days ago.
 * Currently uses only the live SERP results (single snapshot). In absence of
 * historical SERP data, we approximate via `serpFeatures` variety as a proxy
 * for a contested SERP, normalised to 0-100.
 *
 * When historical SERP comparison is available, replace this with real domain-churn logic.
 */
export function computeSerpVolatilityFromResults(
  serpFeatures: string[],
  organicResultCount: number,
): number {
  // No data → no volatility signal
  if (organicResultCount === 0 && serpFeatures.length === 0) return 0;

  // Heuristic: more SERP features + fewer organic results = more volatile
  const featureScore = Math.min(serpFeatures.length / 5, 1); // up to 5 features → 100%
  // Only apply competition score when we have actual organic results
  const competitionScore =
    organicResultCount === 0 ? 0
    : organicResultCount < 5 ? 1
    : organicResultCount < 8 ? 0.5
    : 0.2;
  return Math.round((featureScore * 0.6 + competitionScore * 0.4) * 100);
}

/**
 * Source diversity score (0, 50, or 100).
 * A topic confirmed by multiple distinct sources is a stronger trend signal.
 */
export function computeSourceDiversity(signals: ExternalSignal[]): number {
  const uniqueSources = new Set(signals.map((s) => s.source));
  if (uniqueSources.size <= 1) return 0;  // 0 or 1 distinct source → no diversity signal
  if (uniqueSources.size === 2) return 50;
  return 100; // 3+ sources
}

/**
 * Compute the existing-coverage penalty (0-100) from a raw similarity score.
 *
 * Scale: similarity 0.85 → penalty 100, similarity 0.50 → penalty 0.
 * Linear interpolation between the two anchors.
 */
export function computeCoveragePenalty(maxSimilarity: number): number {
  const HIGH = 0.85;
  const LOW = 0.50;
  if (maxSimilarity >= HIGH) return 100;
  if (maxSimilarity <= LOW) return 0;
  const ratio = (maxSimilarity - LOW) / (HIGH - LOW);
  return Math.round(ratio * 100);
}

// ─── Main: computeTrendScore ──────────────────────────────────────────────────

export type ComputeTrendScoreInput = {
  projectId: string;
  candidate: SynthesisTopic;
  signalPool: ExternalSignal[];
  /** Max cosine similarity to any existing article; from coverage check */
  maxExistingSimilarity: number;
  /**
   * Spec 64.19 / Phase D — per-project weight override. Partial: unset knobs
   * fall back to the `W` defaults. `null`/omitted = all defaults. Loaded by
   * the caller from `project_planner_config.trend_score_weights`.
   */
  weightsOverride?: TrendScoreWeights | null;
};

export async function computeTrendScore(
  input: ComputeTrendScoreInput,
): Promise<ScoreBreakdown> {
  const { projectId, candidate, signalPool, maxExistingSimilarity, weightsOverride } = input;
  const weights = resolveTrendScoreWeights(weightsOverride);

  const candidateSignals = signalPool.filter((s) =>
    candidate.related_signal_ids.includes(s.id)
  );

  const buzz = computeCommunityBuzz(candidateSignals);
  const official = computeOfficialAnnouncementBonus(candidateSignals);
  const diversity = computeSourceDiversity(candidateSignals);
  const coveragePenalty = computeCoveragePenalty(maxExistingSimilarity);

  // DataForSEO Trends — optional; falls back to 0 on failure
  let growth = 0;
  try {
    const trends = await dataforseo.trendsExplore({
      projectId,
      operation: `trend-score-growth-${slugify(candidate.primary_keyword)}`,
      keywords: [candidate.primary_keyword],
      estimatedCostEur: 0.011,
    });
    growth = normalizeGrowthRatio(trends[0]?.growth_ratio ?? null);
  } catch (e) {
    log.warn({ err: e, keyword: candidate.primary_keyword }, "trendsExplore failed — growth=0");
  }

  // DataForSEO SERP — optional; falls back to 0 on failure
  let serpVol = 0;
  try {
    const serp = await dataforseo.serp({
      projectId,
      operation: `trend-score-serp-${slugify(candidate.primary_keyword)}`,
      keyword: candidate.primary_keyword,
      depth: 10,
      estimatedCostEur: 0.002,
    });
    serpVol = computeSerpVolatilityFromResults(
      serp.serpFeatures,
      serp.organicResults.length,
    );
  } catch (e) {
    log.warn({ err: e, keyword: candidate.primary_keyword }, "serp failed — serpVolatility=0");
  }

  const raw =
    (weights.buzz * buzz) / 100 +
    (weights.growth * growth) / 100 +
    (weights.official * official) / 100 +
    (weights.serp * serpVol) / 100 +
    (weights.diversity * diversity) / 100 -
    (weights.coverage * coveragePenalty) / 100;

  const total = Math.round(clamp(raw, 0, 100));

  log.debug(
    {
      projectId,
      topicTitle: candidate.topic_title,
      buzz,
      growth,
      official,
      serpVol,
      diversity,
      coveragePenalty,
      total,
      weights,
      hasOverride: !!weightsOverride,
    },
    "trend score computed"
  );

  return {
    community_buzz: buzz,
    search_volume_growth: growth,
    official_announcement: official,
    serp_volatility: serpVol,
    source_diversity: diversity,
    existing_coverage_penalty: coveragePenalty,
    total,
  };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 50);
}
