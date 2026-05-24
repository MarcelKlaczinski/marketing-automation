// Spec 64.19 / Phase D — unit tests for the per-project trend-score weight
// resolver. The function is called once per trend-synthesis run and must
// handle null / undefined / partial overrides without surprises so the score
// formula in `packages/pipelines/.../score.ts` always receives a fully-defined
// `ResolvedTrendScoreWeights` shape.

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TREND_SCORE_WEIGHTS,
  resolveTrendScoreWeights,
  type ResolvedTrendScoreWeights,
} from "../src/types/project-config.ts";

describe("resolveTrendScoreWeights", () => {
  const ALL_DEFAULT: ResolvedTrendScoreWeights = {
    buzz: 15,
    growth: 15,
    official: 25,
    serp: 20,
    diversity: 25,
    coverage: 40,
  };

  it("null override → all defaults", () => {
    expect(resolveTrendScoreWeights(null)).toEqual(ALL_DEFAULT);
  });

  it("undefined override → all defaults", () => {
    expect(resolveTrendScoreWeights(undefined)).toEqual(ALL_DEFAULT);
  });

  it("empty object override → all defaults", () => {
    expect(resolveTrendScoreWeights({})).toEqual(ALL_DEFAULT);
  });

  it("partial override merges with defaults", () => {
    const result = resolveTrendScoreWeights({ buzz: 50, growth: 0 });
    expect(result.buzz).toBe(50);
    expect(result.growth).toBe(0);
    // Untouched knobs fall back to defaults.
    expect(result.official).toBe(ALL_DEFAULT.official);
    expect(result.serp).toBe(ALL_DEFAULT.serp);
    expect(result.diversity).toBe(ALL_DEFAULT.diversity);
    expect(result.coverage).toBe(ALL_DEFAULT.coverage);
  });

  it("explicit undefined in override falls back to default for that knob", () => {
    const result = resolveTrendScoreWeights({ buzz: undefined, growth: 30 });
    expect(result.buzz).toBe(ALL_DEFAULT.buzz);
    expect(result.growth).toBe(30);
  });

  it("zero is a valid override value — not coerced to default", () => {
    const result = resolveTrendScoreWeights({
      buzz: 0,
      growth: 0,
      official: 0,
      serp: 0,
      diversity: 0,
      coverage: 0,
    });
    expect(result).toEqual({
      buzz: 0,
      growth: 0,
      official: 0,
      serp: 0,
      diversity: 0,
      coverage: 0,
    });
  });

  it("returns a fresh object each call — caller mutation does not leak into defaults", () => {
    const a = resolveTrendScoreWeights(null);
    a.buzz = 999;
    const b = resolveTrendScoreWeights(null);
    expect(b.buzz).toBe(ALL_DEFAULT.buzz);
    expect(DEFAULT_TREND_SCORE_WEIGHTS.buzz).toBe(ALL_DEFAULT.buzz);
  });
});
