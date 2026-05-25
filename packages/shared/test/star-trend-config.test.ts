// Spec 64.21 — unit tests for the per-project star-trend config resolver.
// Mirrors the trend-score-weights resolver tests (Spec 64.19 / Phase D).

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STAR_TREND_CONFIG,
  resolveStarTrendConfig,
  type ResolvedStarTrendConfig,
} from "../src/types/project-config.ts";

describe("resolveStarTrendConfig", () => {
  const ALL_DEFAULT: ResolvedStarTrendConfig = {
    absoluteThreshold:      5_000,
    relativeThresholdPct:   50,
    minAbsoluteForRelative: 500,
    weeklyCap:              3,
    windowDays:             30,
  };

  it("null override → all defaults", () => {
    expect(resolveStarTrendConfig(null)).toEqual(ALL_DEFAULT);
  });

  it("undefined override → all defaults", () => {
    expect(resolveStarTrendConfig(undefined)).toEqual(ALL_DEFAULT);
  });

  it("empty object override → all defaults", () => {
    expect(resolveStarTrendConfig({})).toEqual(ALL_DEFAULT);
  });

  it("partial override → unset knobs fall back to defaults", () => {
    const merged = resolveStarTrendConfig({ absoluteThreshold: 10_000 });
    expect(merged.absoluteThreshold).toBe(10_000);
    expect(merged.relativeThresholdPct).toBe(DEFAULT_STAR_TREND_CONFIG.relativeThresholdPct);
    expect(merged.minAbsoluteForRelative).toBe(DEFAULT_STAR_TREND_CONFIG.minAbsoluteForRelative);
    expect(merged.weeklyCap).toBe(DEFAULT_STAR_TREND_CONFIG.weeklyCap);
    expect(merged.windowDays).toBe(DEFAULT_STAR_TREND_CONFIG.windowDays);
  });

  it("explicit undefined fields shouldn't shadow defaults via spread", () => {
    // Zod-optional roundtrip can serialize as `undefined`. The resolver must
    // use `??` not `...spread` so undefined falls through to defaults.
    const merged = resolveStarTrendConfig({ weeklyCap: undefined, windowDays: 60 });
    expect(merged.weeklyCap).toBe(DEFAULT_STAR_TREND_CONFIG.weeklyCap);
    expect(merged.windowDays).toBe(60);
  });

  it("explicit zero is a valid override (NOT defaults)", () => {
    // weeklyCap=0 = disable star-trend brief emission entirely. Must survive
    // the ?? operator (zero is falsy in JS but ?? only nulls/undefined fall
    // through).
    const merged = resolveStarTrendConfig({ weeklyCap: 0 });
    expect(merged.weeklyCap).toBe(0);
  });

  it("returns a fresh object — mutating the result does NOT poison defaults", () => {
    const r1 = resolveStarTrendConfig(null);
    r1.absoluteThreshold = 999;
    const r2 = resolveStarTrendConfig(null);
    expect(r2.absoluteThreshold).toBe(5_000);
  });
});
