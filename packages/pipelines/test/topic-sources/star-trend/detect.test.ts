/**
 * Spec 64.21 — unit tests for the pure detect module.
 * No DB / network — all branches of detectStarTrend covered.
 */

import { describe, expect, it } from "bun:test";
import { DEFAULT_STAR_TREND_CONFIG } from "@marketing-auto/shared";
import { detectStarTrend } from "../../../src/topic-sources/star-trend/detect.ts";

describe("detectStarTrend", () => {
  const config = DEFAULT_STAR_TREND_CONFIG;

  it("fires absolute trigger when growth >= absoluteThreshold", () => {
    // +6000 in 30d (above default 5000 threshold), 200% growth (also above relative,
    // but absolute wins on tie)
    const r = detectStarTrend({ priorStarsCount: 3000, currentStarsCount: 9000, config });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("absolute");
    expect(r.growthAbsolute).toBe(6000);
    expect(r.growthPct).toBe(200);
  });

  it("fires relative trigger when growth >= relativeThresholdPct AND current >= minAbsoluteForRelative", () => {
    // +600 (below 5000 absolute), but 75% growth on a 800-star base → current = 1400 (above 500 floor)
    const r = detectStarTrend({ priorStarsCount: 800, currentStarsCount: 1400, config });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("relative");
    expect(r.growthAbsolute).toBe(600);
    expect(r.growthPct).toBe(75);
  });

  it("does NOT fire when growth pct meets threshold but current below minAbsoluteForRelative", () => {
    // 100% growth on 100 → current = 200 < 500 floor → no trigger
    const r = detectStarTrend({ priorStarsCount: 100, currentStarsCount: 200, config });
    expect(r.triggered).toBe(false);
    expect(r.trigger).toBe("none");
    expect(r.growthAbsolute).toBe(100);
    expect(r.growthPct).toBe(100);
  });

  it("does NOT fire on small growth that misses both thresholds", () => {
    // +100 absolute, 5% growth — neither triggers
    const r = detectStarTrend({ priorStarsCount: 2000, currentStarsCount: 2100, config });
    expect(r.triggered).toBe(false);
    expect(r.trigger).toBe("none");
  });

  it("does NOT fire on zero growth (currentStarsCount === priorStarsCount)", () => {
    const r = detectStarTrend({ priorStarsCount: 50_000, currentStarsCount: 50_000, config });
    expect(r.triggered).toBe(false);
    expect(r.growthAbsolute).toBe(0);
    expect(r.growthPct).toBe(0);
  });

  it("does NOT fire on negative growth (lost stars — different editorial angle)", () => {
    const r = detectStarTrend({ priorStarsCount: 10_000, currentStarsCount: 9_500, config });
    expect(r.triggered).toBe(false);
    expect(r.trigger).toBe("none");
    expect(r.growthAbsolute).toBe(-500);
  });

  it("guards against prior=0 (division by zero) — growthPct=0, only absolute trigger possible", () => {
    // priorStarsCount=0 means the inventory row had 0 stars at the snapshot point.
    // growthPct would be Infinity; guard returns 0. Absolute trigger still works
    // because growthAbsolute = currentStarsCount.
    const r = detectStarTrend({ priorStarsCount: 0, currentStarsCount: 7000, config });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("absolute");
    expect(r.growthAbsolute).toBe(7000);
    expect(r.growthPct).toBe(0);
  });

  it("treats prior=0 + small current as no-trigger (no relative path, absolute too small)", () => {
    const r = detectStarTrend({ priorStarsCount: 0, currentStarsCount: 100, config });
    expect(r.triggered).toBe(false);
    expect(r.growthAbsolute).toBe(100);
    expect(r.growthPct).toBe(0);
  });

  it("respects custom config — overridden absoluteThreshold of 1000 triggers earlier", () => {
    const customConfig = { ...DEFAULT_STAR_TREND_CONFIG, absoluteThreshold: 1000 };
    const r = detectStarTrend({ priorStarsCount: 5000, currentStarsCount: 6500, config: customConfig });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("absolute");
  });

  it("rounds growthPct to 2 decimals to keep JSONB stable across reruns", () => {
    // 1/3 growth = 33.333…%. Rounded to 33.33.
    const r = detectStarTrend({ priorStarsCount: 3000, currentStarsCount: 4000, config });
    expect(r.growthPct).toBe(33.33);
  });

  it("absolute wins on tie when BOTH rules would fire", () => {
    // +5500 absolute (above 5000 threshold) AND 110% growth on 5000-star base
    // (above 50% threshold, current = 10500 > 500 floor). Absolute is reported.
    const r = detectStarTrend({ priorStarsCount: 5000, currentStarsCount: 10_500, config });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("absolute");
  });

  it("threshold==growth is treated as a hit (>=, not >)", () => {
    // Exactly 5000 growth — meets the >= threshold.
    const r = detectStarTrend({ priorStarsCount: 1000, currentStarsCount: 6000, config });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe("absolute");
    expect(r.growthAbsolute).toBe(5000);
  });
});
