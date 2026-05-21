// Spec 63.5: pure math for the planner's soft topic-diversity modifier.
//
// `cosineSimilarity` is the L2-normalized dot product of two equal-length
// vectors. `adjustScoreWithDiversity` applies a linear malus above a
// configurable threshold against the maximum similarity to an already-picked
// set. Both functions are deterministic and free of I/O — keep them that way
// so the picker can call them inside a tight loop.

/**
 * Cosine similarity in [-1, 1]. For non-negative embeddings (e.g. Voyage's
 * voyage-3 output) the practical range collapses to roughly [0, 1]. Returns 0
 * when either vector is the zero vector (no direction information).
 *
 * Vectors must have identical length; mismatched lengths produce a degenerate
 * result silently — callers are expected to pair embeddings produced by the
 * same model.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface DiversityConfig {
  /** Cosine-similarity above which a malus begins (0..1). */
  threshold: number;
  /** Linear malus slope above the threshold. 0 disables diversity. */
  malusWeight: number;
}

export interface DiversityAdjustment {
  /** baseScore minus malus. May be < 0 if malus > baseScore. */
  adjustedScore: number;
  /** Magnitude of the deduction in score-units. */
  malus: number;
  /** Highest cosine-similarity observed against any picked embedding. */
  maxSimilarity: number;
}

/**
 * Apply a linear-above-threshold malus to a base score based on the maximum
 * cosine-similarity to an already-picked set. A brief with no embedding or
 * an empty picked set returns its base score unchanged. The malus formula:
 *
 *     malusRatio = (maxSim - threshold) / (1 - threshold)
 *     malus      = malusWeight * malusRatio                // clamped at maxSim == 1
 *     adjusted   = baseScore - malus
 *
 * Notes:
 *   - `threshold == 1` disables diversity (divide-by-zero is guarded — malus stays 0).
 *   - `malusWeight == 0` disables diversity (off-switch).
 *   - `null` entries in `pickedEmbeddings` are skipped — they represent picks
 *     whose embedding could not be resolved (e.g. brief missing primaryKeyword
 *     and no cluster fallback). The pick still counts toward the picked-set
 *     count for audit purposes, but contributes no diversity signal.
 */
export function adjustScoreWithDiversity(
  baseScore: number,
  briefEmbedding: number[] | null,
  pickedEmbeddings: (number[] | null)[],
  config: DiversityConfig,
): DiversityAdjustment {
  if (config.malusWeight <= 0 || config.threshold >= 1) {
    return { adjustedScore: baseScore, malus: 0, maxSimilarity: 0 };
  }
  if (!briefEmbedding || pickedEmbeddings.length === 0) {
    return { adjustedScore: baseScore, malus: 0, maxSimilarity: 0 };
  }

  let maxSim = 0;
  for (const picked of pickedEmbeddings) {
    if (!picked) continue;
    const sim = cosineSimilarity(briefEmbedding, picked);
    if (sim > maxSim) maxSim = sim;
  }

  if (maxSim < config.threshold) {
    return { adjustedScore: baseScore, malus: 0, maxSimilarity: maxSim };
  }

  const malusRatio = (maxSim - config.threshold) / (1 - config.threshold);
  const malus = config.malusWeight * malusRatio;
  return {
    adjustedScore: baseScore - malus,
    malus,
    maxSimilarity: maxSim,
  };
}
