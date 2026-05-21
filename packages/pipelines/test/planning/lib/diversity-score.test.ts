// Spec 63.5: unit tests for the pure diversity-score math.
// No DB, no I/O — just the cosine + linear-malus formula.

import { describe, expect, it } from "bun:test";
import {
  adjustScoreWithDiversity,
  cosineSimilarity,
} from "../../../src/planning/lib/diversity-score.ts";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it("returns -1 for antiparallel vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("returns 0 when either vector is zero (no direction)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("handles mismatched lengths by truncating to the shorter", () => {
    // [1, 0] vs [1, 0, 99] → only the first two coords compared
    expect(cosineSimilarity([1, 0], [1, 0, 99])).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = [0.3, 0.4, 0.5];
    const b = [0.1, 0.9, 0.2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe("adjustScoreWithDiversity", () => {
  const cfg = { threshold: 0.5, malusWeight: 0.5 };

  it("returns baseScore unchanged when pickedEmbeddings is empty", () => {
    const r = adjustScoreWithDiversity(0.8, [1, 0], [], cfg);
    expect(r.adjustedScore).toBe(0.8);
    expect(r.malus).toBe(0);
    expect(r.maxSimilarity).toBe(0);
  });

  it("returns baseScore unchanged when briefEmbedding is null (skip-diversity)", () => {
    const r = adjustScoreWithDiversity(0.8, null, [[1, 0]], cfg);
    expect(r.adjustedScore).toBe(0.8);
    expect(r.malus).toBe(0);
  });

  it("returns baseScore unchanged when similarity below threshold", () => {
    // orthogonal — sim = 0 < threshold 0.5
    const r = adjustScoreWithDiversity(0.8, [1, 0], [[0, 1]], cfg);
    expect(r.adjustedScore).toBe(0.8);
    expect(r.malus).toBe(0);
    expect(r.maxSimilarity).toBeCloseTo(0, 5);
  });

  it("applies linear malus above threshold", () => {
    // identical — sim = 1.0
    // malusRatio = (1 - 0.5) / (1 - 0.5) = 1
    // malus = 0.5 * 1 = 0.5
    // adjusted = 0.8 - 0.5 = 0.3
    const r = adjustScoreWithDiversity(0.8, [1, 0], [[1, 0]], cfg);
    expect(r.maxSimilarity).toBeCloseTo(1, 5);
    expect(r.malus).toBeCloseTo(0.5, 5);
    expect(r.adjustedScore).toBeCloseTo(0.3, 5);
  });

  it("uses the MAX similarity across the picked-set", () => {
    // [1,0] vs picked {[0,1] (sim 0), [1,0] (sim 1)} — max = 1
    const r = adjustScoreWithDiversity(
      0.8,
      [1, 0],
      [
        [0, 1],
        [1, 0],
      ],
      cfg,
    );
    expect(r.maxSimilarity).toBeCloseTo(1, 5);
  });

  it("ignores null entries in pickedEmbeddings (audit-only picks)", () => {
    const r = adjustScoreWithDiversity(0.8, [1, 0], [null, [0, 1]], cfg);
    expect(r.maxSimilarity).toBeCloseTo(0, 5);
    expect(r.malus).toBe(0);
  });

  it("threshold=1 disables diversity (off)", () => {
    const r = adjustScoreWithDiversity(0.8, [1, 0], [[1, 0]], {
      threshold: 1,
      malusWeight: 0.5,
    });
    expect(r.malus).toBe(0);
    expect(r.adjustedScore).toBe(0.8);
  });

  it("malusWeight=0 disables diversity (off-switch)", () => {
    const r = adjustScoreWithDiversity(0.8, [1, 0], [[1, 0]], {
      threshold: 0.5,
      malusWeight: 0,
    });
    expect(r.malus).toBe(0);
    expect(r.adjustedScore).toBe(0.8);
  });

  it("partial similarity above threshold produces proportional malus", () => {
    // sim ≈ 0.8 (vec [0.8, 0.6] vs [1, 0] = 0.8 cosine)
    // malusRatio = (0.8 - 0.5) / 0.5 = 0.6
    // malus = 0.5 * 0.6 = 0.3
    const r = adjustScoreWithDiversity(0.9, [0.8, 0.6], [[1, 0]], cfg);
    expect(r.maxSimilarity).toBeCloseTo(0.8, 5);
    expect(r.malus).toBeCloseTo(0.3, 5);
    expect(r.adjustedScore).toBeCloseTo(0.6, 5);
  });

  it("can produce negative adjustedScore when malus exceeds baseScore", () => {
    // sim = 1, baseScore = 0.2, malus = 0.5 → adjusted = -0.3
    const r = adjustScoreWithDiversity(0.2, [1, 0], [[1, 0]], cfg);
    expect(r.adjustedScore).toBeCloseTo(-0.3, 5);
    // not clamped — callers use this for sort ordering, not display
  });
});
