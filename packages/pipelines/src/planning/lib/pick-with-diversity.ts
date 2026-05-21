// Spec 63.5: iterative diversity-aware picker.
//
// For each pick: build (briefEmbedding, baseScore, adjustedScore) for every
// remaining brief, sort by adjustedScore desc (stable), pick the top, and
// repeat. The malus is computed against the running picked-set so each round
// captures cross-pick redundancy.
//
// O(target × pool × dim). At dim=1024, pool=100, target=10 → ~1M ops, sub-100ms
// in practice. Beyond that scale, switch to a precomputed pairwise similarity
// matrix (Phase E).

import type { TopicBrief } from "@marketing-auto/db";
import {
  type DiversityConfig,
  adjustScoreWithDiversity,
} from "./diversity-score.ts";
import type { EmbeddingProvider } from "./diversity-embedding.ts";

export interface DiversityPickReason {
  /** Stable item id (brief.id / signal.signalId / article.id). */
  itemId: string;
  /** Pick order (1-based). */
  pickIndex: number;
  baseScore: number;
  adjustedScore: number;
  malus: number;
  maxSimilarity: number;
  /** Human-readable audit string for `planned_items.selectionReason`. */
  reason: string;
}

export interface PickWithDiversityOptions<T> {
  /** Candidate items in priority order — already sorted by the caller. */
  pool: T[];
  /** Number of items to pick (capped by pool length). */
  target: number;
  /** Provides + caches per-item embeddings for the lifetime of the run. */
  embeddingProvider: EmbeddingProvider<T>;
  /** Threshold + malus weight; from the frozen plannerConfigSnapshot. */
  config: DiversityConfig;
  /** Returns the normalized base score for the item in [0, 1]. */
  getBaseScore: (item: T) => number;
  /** Returns the stable id for audit + log lines. */
  getItemId: (item: T) => string;
  /**
   * Embeddings already picked by an upstream step (e.g. Floor → Overage). The
   * provider's cache is NOT consulted for these — pass concrete vectors so
   * cross-step diversity works even when the upstream step ran on a different
   * provider instance (e.g. brief-provider vs signal-provider).
   */
  initialPickedEmbeddings?: (number[] | null)[];
}

export interface PickWithDiversityResult<T> {
  picked: T[];
  reasons: DiversityPickReason[];
}

/**
 * Iterative diversity-aware picker. Picks one brief per round, re-scoring the
 * remaining pool against the running picked-set each time. The first pick
 * always has no diversity malus (empty picked-set) UNLESS `initialPickedEmbeddings`
 * is non-empty, in which case the first round already sees a non-trivial set
 * — that's how Overage Selector inherits Floor diversity context.
 */
export async function pickWithDiversity<T>(
  opts: PickWithDiversityOptions<T>,
): Promise<PickWithDiversityResult<T>> {
  const { pool, target, embeddingProvider, config, getBaseScore, getItemId } = opts;
  const picked: T[] = [];
  const reasons: DiversityPickReason[] = [];
  // Embeddings of items already in the picked-set. Seeded from upstream when
  // the caller passes them; appended as we pick.
  const pickedEmbeddings: (number[] | null)[] = [
    ...(opts.initialPickedEmbeddings ?? []),
  ];
  const initialCount = pickedEmbeddings.length;
  const remaining: T[] = [...pool];

  const cap = Math.min(target, remaining.length);
  while (picked.length < cap && remaining.length > 0) {
    // Resolve embeddings for all remaining items once per round. The
    // provider caches by id so the per-round cost is one map-lookup per
    // item after the first round.
    const scored = await Promise.all(
      remaining.map(async (item) => {
        const emb = await embeddingProvider.getForItem(item);
        const baseScore = getBaseScore(item);
        const adjustment = adjustScoreWithDiversity(
          baseScore,
          emb,
          pickedEmbeddings,
          config,
        );
        return { item, baseScore, ...adjustment, embedding: emb };
      }),
    );

    // Sort by adjusted score desc; ties broken by the order items appear in
    // `remaining` (Array.prototype.sort is stable in V8 / Bun's JSC since
    // 2018, so equal-score items preserve their existing relative order —
    // which is the original pool order minus already-picked items).
    scored.sort((a, b) => b.adjustedScore - a.adjustedScore);
    const top = scored[0];
    if (!top) break; // defensive — cap above guarantees remaining.length > 0

    picked.push(top.item);
    pickedEmbeddings.push(top.embedding);

    const pickIndex = picked.length;
    const pickedFromDiversity = pickedEmbeddings.length - 1 - initialCount;
    const reason =
      top.malus > 0
        ? `picked #${pickIndex} (base=${top.baseScore.toFixed(2)}, malus=${top.malus.toFixed(2)} vs ${pickedFromDiversity} picked, sim=${top.maxSimilarity.toFixed(2)}, final=${top.adjustedScore.toFixed(2)})`
        : `picked #${pickIndex} (score=${top.baseScore.toFixed(2)}, no diversity malus)`;
    reasons.push({
      itemId: getItemId(top.item),
      pickIndex,
      baseScore: top.baseScore,
      adjustedScore: top.adjustedScore,
      malus: top.malus,
      maxSimilarity: top.maxSimilarity,
      reason,
    });

    // Remove the picked item from `remaining`. Use indexOf since we just
    // pushed it; safe as `remaining` is the same array we sorted over.
    const idx = remaining.indexOf(top.item);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  return { picked, reasons };
}

/**
 * Source-aware base-score normalization. Returns a value in [0, 1] suitable
 * for the diversity-malus to subtract from without one source dominating the
 * others. The Floor selector currently doesn't surface scores per brief — we
 * approximate via the pool index (1 - i/poolLen) so FIFO-position still
 * carries weight when no source-specific number is available.
 *
 * Source → field mapping (Phase 0 findings):
 *   - "trend_discovery": brief.trendMetadata.trendScore ∈ ~[0, 100] → /100
 *   - "comparison_discovery": brief.comparisonMetadata.score ∈ [0, 1] (already 0-1)
 *   - everything else: FIFO surrogate (1 - i/poolLen)
 *
 * Values are clamped to [0, 1] so a malus of 0.5 cannot push a brief into a
 * deeply negative range relative to its neighbours.
 */
export function normalizeBriefBaseScore(
  brief: TopicBrief,
  indexInPool: number,
  poolLength: number,
): number {
  if (brief.source === "trend_discovery") {
    const raw = brief.trendMetadata?.trendScore;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return clamp01(raw / 100);
    }
  }
  if (brief.source === "comparison_discovery") {
    const raw = brief.comparisonMetadata?.score;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return clamp01(raw);
    }
  }
  if (poolLength <= 1) return 1;
  return clamp01(1 - indexInPool / poolLength);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
