/**
 * Spec 65.17 B1 — Tercile-ranking tier-derivation from `tool_persona_scores`.
 *
 * Splits a scored tool list into three positive-framing tiers
 * (`solide` / `stark` / `spitze`) by relative rank, not absolute threshold.
 * Always produces balanced tiers regardless of score distribution — the
 * Discovery §3.3 reasoning: a threshold-based split risks an empty "bad" tier
 * when all selected tools score high (or vice-versa), defeating the visual
 * intent of tier-ranking carousels.
 *
 * The tier-labels are intentionally positive ("Solide / Stark / Spitze" not
 * "Bad / Good / Great") because Toolwiki may have affiliate relationships with
 * the underlying tools — see Discovery §3.3 affiliate-safety reasoning.
 *
 * Distribution per tool-count (Discovery §3.3 + Marcel-decision Q7):
 *   3 tools → 1 spitze · 1 stark · 1 solide  (1/1/1)
 *   4 tools → 1 spitze · 2 stark · 1 solide  (1/2/1)
 *   5 tools → 2 spitze · 2 stark · 1 solide  (2/2/1, positive-bias)
 *
 * Score range is INTEGER 0–10 (Phase-0 verified live against Toolwiki DB);
 * higher = better. Score values are not stored on the output — only the tier
 * label — because the composition consumes tier-buckets, not raw scores.
 *
 * Ties: deterministic secondary sort by `toolId ASC` so two tools with the
 * same score always land in the same tier on repeated calls (planner-replay
 * stability — same input always yields same output, no random tie-breaking).
 */

export type TierLabel = "solide" | "stark" | "spitze";

export interface ScoredToolInput {
  /** Article ID of the tool (matches `articles.id` for `collection='tools'`). */
  toolId: string;
  /** Integer 0–10 score, e.g. from `tool_persona_scores.score`. */
  score: number;
}

export interface TieredTool extends ScoredToolInput {
  tier: TierLabel;
}

/**
 * Split scored tools into 3 positive tiers via tercile-ranking.
 *
 * @param scored - Array of 3–5 scored tools.
 * @returns Same tools, each annotated with a tier label, in tier-DESC order
 *          (spitze first, solide last) — convenient for top-down rendering.
 * @throws if fewer than 3 tools are passed — tier-ranking requires at least
 *         one tool per tier. Callers should pre-filter to a 3–5 tool pool
 *         (Marcel-decision Q7) and skip-with-notify if the pool is too thin.
 */
export function deriveTiers(scored: readonly ScoredToolInput[]): TieredTool[] {
  if (scored.length < 3) {
    throw new RangeError(
      `deriveTiers requires at least 3 tools, received ${scored.length}. ` +
        "Pre-filter pool + skip brief if too thin (Spec 65.17 §3.3 + Q7).",
    );
  }
  if (scored.length > 5) {
    throw new RangeError(
      `deriveTiers accepts at most 5 tools, received ${scored.length}. ` +
        "Marcel-decision Q7 caps tier-ranking at 5 tools.",
    );
  }

  // Sort DESC by score with deterministic toolId ASC tiebreaker.
  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0;
  });

  const { spitzeCount, starkCount } = bucketCountsFor(sorted.length);

  return sorted.map((tool, idx) => {
    let tier: TierLabel;
    if (idx < spitzeCount) tier = "spitze";
    else if (idx < spitzeCount + starkCount) tier = "stark";
    else tier = "solide";
    return { ...tool, tier };
  });
}

/**
 * Exported for tests so the documented per-count distribution stays in sync
 * with `deriveTiers`. Not consumed by production code.
 */
export function bucketCountsFor(count: 3 | 4 | 5 | number): {
  spitzeCount: number;
  starkCount: number;
  solideCount: number;
} {
  switch (count) {
    case 3:
      return { spitzeCount: 1, starkCount: 1, solideCount: 1 };
    case 4:
      return { spitzeCount: 1, starkCount: 2, solideCount: 1 };
    case 5:
      return { spitzeCount: 2, starkCount: 2, solideCount: 1 };
    default:
      throw new RangeError(
        `bucketCountsFor only supports counts 3, 4, or 5 (got ${count}).`,
      );
  }
}
