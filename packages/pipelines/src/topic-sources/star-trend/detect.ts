/**
 * Spec 64.21 — pure star-trend detection.
 *
 * Two trigger rules (Marcel-decision Q2 = "Beides"):
 *   - **absolute**: growth >= absoluteThreshold (e.g. +5000 stars in N days)
 *   - **relative**: growthPct >= relativeThresholdPct (e.g. +50%) AND
 *                   currentStars >= minAbsoluteForRelative (anti-noise floor)
 *
 * The relative rule's floor prevents 50→100-star repos from triggering — they
 * technically grew 100% but a Star-Trend story about a 100-star repo is
 * editorially weak. The minAbsoluteForRelative floor (default 500) excludes
 * "newborn" repos until they reach the editorial-relevance band.
 *
 * Both rules can fire in the same tick — `trigger` reports whichever rule fired
 * first (absolute wins on tie). The brief still emits once per detection
 * (idempotency at the emit layer via existsBriefForStarTrend window predicate).
 *
 * Pure function — no I/O, fully unit-testable.
 */

import type { ResolvedStarTrendConfig } from "@marketing-auto/shared";

export interface DetectStarTrendInput {
  /** Stars at the start of the detection window (snapshot ≥ windowDays ago). */
  priorStarsCount:   number;
  /** Stars at emission time (latest refresh). */
  currentStarsCount: number;
  /** Resolved config — call `resolveStarTrendConfig(override)` upstream. */
  config:            ResolvedStarTrendConfig;
}

export interface DetectStarTrendResult {
  triggered:      boolean;
  growthAbsolute: number;
  /** Rounded to 2 decimals to keep the JSONB stable across reruns. */
  growthPct:      number;
  trigger:        "absolute" | "relative" | "none";
}

export function detectStarTrend(input: DetectStarTrendInput): DetectStarTrendResult {
  const { priorStarsCount, currentStarsCount, config } = input;

  const growthAbsolute = currentStarsCount - priorStarsCount;
  // Guard zero / negative prior — produces Infinity / negative pct, both
  // structurally invalid. Treat as 0% (no signal).
  const growthPct = priorStarsCount > 0
    ? Math.round((growthAbsolute / priorStarsCount) * 100 * 100) / 100
    : 0;

  // Negative growth (lost stars) never triggers — Star-Trend Stories are
  // upside-only. Repos that lose stars are a different editorial angle.
  if (growthAbsolute <= 0) {
    return { triggered: false, growthAbsolute, growthPct, trigger: "none" };
  }

  const absoluteHit = growthAbsolute >= config.absoluteThreshold;
  const relativeHit =
    growthPct >= config.relativeThresholdPct &&
    currentStarsCount >= config.minAbsoluteForRelative;

  // Absolute wins on tie so the brief metadata reports the simpler-to-explain
  // signal first. UI can still surface both via growthAbsolute + growthPct.
  if (absoluteHit) return { triggered: true, growthAbsolute, growthPct, trigger: "absolute" };
  if (relativeHit) return { triggered: true, growthAbsolute, growthPct, trigger: "relative" };
  return { triggered: false, growthAbsolute, growthPct, trigger: "none" };
}
