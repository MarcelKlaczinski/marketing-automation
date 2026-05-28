/**
 * Spec 65.17 B1 — Tercile-ranking tier-derivation tests.
 *
 * Pure-helper tests covering: per-count distribution, score-DESC ordering with
 * toolId-ASC tiebreaker (replay-determinism), and out-of-range guards.
 */
import { describe, expect, it } from "bun:test";
import {
  bucketCountsFor,
  deriveTiers,
  type ScoredToolInput,
} from "../../../src/lib/recurring-content/derive-tiers";

// Reuse for legibility — output is in tier-DESC order (spitze first).
const tiersInOrder = (
  result: ReturnType<typeof deriveTiers>,
): string[] => result.map((t) => t.tier);

describe("bucketCountsFor", () => {
  it("returns 1/1/1 for 3 tools", () => {
    expect(bucketCountsFor(3)).toEqual({ spitzeCount: 1, starkCount: 1, solideCount: 1 });
  });

  it("returns 1/2/1 for 4 tools (middle band wider)", () => {
    expect(bucketCountsFor(4)).toEqual({ spitzeCount: 1, starkCount: 2, solideCount: 1 });
  });

  it("returns 2/2/1 for 5 tools (positive-bias, more spitze)", () => {
    expect(bucketCountsFor(5)).toEqual({ spitzeCount: 2, starkCount: 2, solideCount: 1 });
  });

  it("throws for unsupported counts", () => {
    expect(() => bucketCountsFor(2)).toThrow(/3, 4, or 5/);
    expect(() => bucketCountsFor(6)).toThrow(/3, 4, or 5/);
  });
});

describe("deriveTiers — distribution", () => {
  it("3 tools → 1 spitze · 1 stark · 1 solide (1/1/1 split)", () => {
    const result = deriveTiers([
      { toolId: "a", score: 9 },
      { toolId: "b", score: 6 },
      { toolId: "c", score: 3 },
    ]);
    expect(tiersInOrder(result)).toEqual(["spitze", "stark", "solide"]);
    expect(result[0]?.toolId).toBe("a");
    expect(result[1]?.toolId).toBe("b");
    expect(result[2]?.toolId).toBe("c");
  });

  it("4 tools → 1 spitze · 2 stark · 1 solide (1/2/1 split)", () => {
    const result = deriveTiers([
      { toolId: "a", score: 10 },
      { toolId: "b", score: 8 },
      { toolId: "c", score: 6 },
      { toolId: "d", score: 2 },
    ]);
    expect(tiersInOrder(result)).toEqual(["spitze", "stark", "stark", "solide"]);
  });

  it("5 tools → 2 spitze · 2 stark · 1 solide (2/2/1 positive-bias)", () => {
    const result = deriveTiers([
      { toolId: "a", score: 10 },
      { toolId: "b", score: 9 },
      { toolId: "c", score: 7 },
      { toolId: "d", score: 5 },
      { toolId: "e", score: 2 },
    ]);
    expect(tiersInOrder(result)).toEqual([
      "spitze",
      "spitze",
      "stark",
      "stark",
      "solide",
    ]);
  });
});

describe("deriveTiers — ordering + tiebreakers", () => {
  it("preserves score-DESC order on output", () => {
    const result = deriveTiers([
      { toolId: "low", score: 2 },
      { toolId: "high", score: 9 },
      { toolId: "mid", score: 5 },
    ]);
    expect(result.map((t) => t.toolId)).toEqual(["high", "mid", "low"]);
  });

  it("breaks score ties deterministically via toolId ASC (replay-stable)", () => {
    // Two pairs of ties — bbb < ccc, aaa < ddd
    const result = deriveTiers([
      { toolId: "ccc", score: 8 },
      { toolId: "bbb", score: 8 },
      { toolId: "ddd", score: 4 },
      { toolId: "aaa", score: 4 },
    ]);
    expect(result.map((t) => t.toolId)).toEqual(["bbb", "ccc", "aaa", "ddd"]);
  });

  it("produces same tier assignment when called twice with same input", () => {
    const scored: ScoredToolInput[] = [
      { toolId: "x", score: 5 },
      { toolId: "y", score: 7 },
      { toolId: "z", score: 5 },
    ];
    const first = deriveTiers(scored);
    const second = deriveTiers(scored);
    expect(first).toEqual(second);
  });

  it("tier-assigns gracefully even when all tools score 0 (degenerate)", () => {
    const result = deriveTiers([
      { toolId: "a", score: 0 },
      { toolId: "b", score: 0 },
      { toolId: "c", score: 0 },
    ]);
    // All-zero → tercile by toolId ASC; spitze is just "first by id"
    expect(result.map((t) => t.tier)).toEqual(["spitze", "stark", "solide"]);
    expect(result.map((t) => t.toolId)).toEqual(["a", "b", "c"]);
  });

  it("tier-assigns gracefully when all tools score 10 (no separation)", () => {
    const result = deriveTiers([
      { toolId: "c", score: 10 },
      { toolId: "a", score: 10 },
      { toolId: "b", score: 10 },
    ]);
    expect(result.map((t) => t.toolId)).toEqual(["a", "b", "c"]);
    expect(result.map((t) => t.tier)).toEqual(["spitze", "stark", "solide"]);
  });
});

describe("deriveTiers — guards", () => {
  it("throws when fewer than 3 tools are supplied", () => {
    expect(() => deriveTiers([{ toolId: "x", score: 5 }])).toThrow(/at least 3/);
    expect(() =>
      deriveTiers([
        { toolId: "x", score: 5 },
        { toolId: "y", score: 6 },
      ]),
    ).toThrow(/at least 3/);
  });

  it("throws when more than 5 tools are supplied (Marcel Q7 cap)", () => {
    const six: ScoredToolInput[] = Array.from({ length: 6 }, (_, i) => ({
      toolId: `t${i}`,
      score: i,
    }));
    expect(() => deriveTiers(six)).toThrow(/at most 5/);
  });
});
