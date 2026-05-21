// Spec 62.4: signal-top-n normalisation tests.

import { describe, expect, it } from "bun:test";
import { mergeAndTopN, normalizePerSource, rawScoreFor } from "../src/index.ts";

describe("rawScoreFor", () => {
  it("picks votes_count for producthunt", () => {
    expect(
      rawScoreFor({ source: "producthunt", metrics: { votes_count: 42 }, summary: null }),
    ).toBe(42);
  });

  it("picks points for hackernews", () => {
    expect(
      rawScoreFor({ source: "hackernews", metrics: { points: 1200 }, summary: null }),
    ).toBe(1200);
  });

  it("falls back to summary length for vendor_rss", () => {
    expect(
      rawScoreFor({ source: "vendor_rss", metrics: {}, summary: "x".repeat(300) }),
    ).toBe(300);
  });

  it("returns 0 when metrics is missing", () => {
    expect(
      rawScoreFor({ source: "producthunt", metrics: {}, summary: null }),
    ).toBe(0);
  });

  it("ignores negative or non-finite metrics", () => {
    expect(
      rawScoreFor({ source: "hackernews", metrics: { points: -1 }, summary: null }),
    ).toBe(0);
  });
});

describe("normalizePerSource", () => {
  it("assigns rank=1 → 1.0 within a group of 3", () => {
    const input = [
      { signalId: "a", source: "producthunt", title: "A", url: null, rawScore: 100 },
      { signalId: "b", source: "producthunt", title: "B", url: null, rawScore: 50 },
      { signalId: "c", source: "producthunt", title: "C", url: null, rawScore: 10 },
    ];
    const out = normalizePerSource(input);
    const a = out.find((r) => r.signalId === "a")!;
    const b = out.find((r) => r.signalId === "b")!;
    const c = out.find((r) => r.signalId === "c")!;
    expect(a.normalizedScore).toBeCloseTo(1.0, 5);
    expect(b.normalizedScore).toBeCloseTo(2 / 3, 5);
    expect(c.normalizedScore).toBeCloseTo(1 / 3, 5);
  });

  it("normalises each source independently", () => {
    const out = normalizePerSource([
      { signalId: "ph1", source: "producthunt", title: "PH1", url: null, rawScore: 500 },
      { signalId: "ph2", source: "producthunt", title: "PH2", url: null, rawScore: 100 },
      { signalId: "hn1", source: "hackernews", title: "HN1", url: null, rawScore: 2000 },
    ]);
    expect(out.find((r) => r.signalId === "ph1")!.normalizedScore).toBeCloseTo(1.0, 5);
    expect(out.find((r) => r.signalId === "hn1")!.normalizedScore).toBeCloseTo(1.0, 5);
  });

  it("returns score=1.0 for a single-element group", () => {
    const out = normalizePerSource([
      { signalId: "x", source: "github", title: "X", url: null, rawScore: 999 },
    ]);
    expect(out[0]!.normalizedScore).toBeCloseTo(1.0, 5);
  });

  it("returns empty array for empty input", () => {
    expect(normalizePerSource([])).toEqual([]);
  });
});

describe("mergeAndTopN directionality (best signal first)", () => {
  // This guards SelectOverageItemsStep, which takes the FIRST N entries
  // returned here and treats them as the "hottest" signals to amplify into
  // planned_items. A flipped sort here would route the worst signals.

  it("returns the highest normalizedScore first", () => {
    const rows = [
      {
        signalId: "low",
        source: "producthunt",
        title: "low",
        url: null,
        rawScore: 10,
        normalizedScore: 0.2,
      },
      {
        signalId: "high",
        source: "hackernews",
        title: "high",
        url: null,
        rawScore: 1000,
        normalizedScore: 1.0,
      },
      {
        signalId: "mid",
        source: "github",
        title: "mid",
        url: null,
        rawScore: 100,
        normalizedScore: 0.5,
      },
    ];
    const out = mergeAndTopN(rows, 3);
    expect(out.map((r) => r.signalId)).toEqual(["high", "mid", "low"]);
  });

  it("slicing to N=1 selects the BEST, never the worst", () => {
    const rows = [
      {
        signalId: "worst",
        source: "producthunt",
        title: "worst",
        url: null,
        rawScore: 1,
        normalizedScore: 0.01,
      },
      {
        signalId: "best",
        source: "producthunt",
        title: "best",
        url: null,
        rawScore: 9999,
        normalizedScore: 1.0,
      },
    ];
    const top1 = mergeAndTopN(rows, 1);
    expect(top1).toHaveLength(1);
    expect(top1[0]!.signalId).toBe("best");
    expect(top1[0]!.normalizedScore).toBe(1.0);
  });

  it("end-to-end: normalize + mergeAndTopN preserves best→worst direction", () => {
    // Mixed across two sources; input order is intentionally shuffled.
    const input = [
      { signalId: "ph-mid", source: "producthunt", title: "ph-mid", url: null, rawScore: 50 },
      { signalId: "hn-top", source: "hackernews", title: "hn-top", url: null, rawScore: 5000 },
      { signalId: "ph-top", source: "producthunt", title: "ph-top", url: null, rawScore: 500 },
      { signalId: "hn-mid", source: "hackernews", title: "hn-mid", url: null, rawScore: 50 },
      { signalId: "ph-low", source: "producthunt", title: "ph-low", url: null, rawScore: 5 },
    ];
    const normalised = normalizePerSource(input);
    // Per-source ranks → normalizedScore:
    //   ProductHunt (n=3): ph-top=1.0, ph-mid=2/3, ph-low=1/3
    //   HackerNews  (n=2): hn-top=1.0, hn-mid=0.5
    // Sort by normalizedScore DESC, tie-break by rawScore DESC:
    //   1. hn-top  (1.0, raw=5000)
    //   2. ph-top  (1.0, raw=500)   ← rawScore tie-break
    //   3. ph-mid  (0.667)          ← beats hn-mid (0.5)
    const top3 = mergeAndTopN(normalised, 3);
    expect(top3.map((r) => r.signalId)).toEqual(["hn-top", "ph-top", "ph-mid"]);
    expect(top3[0]!.normalizedScore).toBeCloseTo(1.0, 5);
    expect(top3[0]!.rawScore).toBe(5000); // highest raw wins the score tie
    // The lowest-raw item must NOT be in the top-3 selection.
    expect(top3.find((r) => r.signalId === "ph-low")).toBeUndefined();
  });

  it("topN=0 returns empty (degenerate but valid)", () => {
    const rows = [
      {
        signalId: "x",
        source: "producthunt",
        title: "x",
        url: null,
        rawScore: 100,
        normalizedScore: 1.0,
      },
    ];
    expect(mergeAndTopN(rows, 0)).toEqual([]);
  });

  it("topN > input length returns all rows", () => {
    const rows = [
      {
        signalId: "a",
        source: "producthunt",
        title: "a",
        url: null,
        rawScore: 100,
        normalizedScore: 1.0,
      },
      {
        signalId: "b",
        source: "producthunt",
        title: "b",
        url: null,
        rawScore: 50,
        normalizedScore: 0.5,
      },
    ];
    expect(mergeAndTopN(rows, 10)).toHaveLength(2);
  });
});
