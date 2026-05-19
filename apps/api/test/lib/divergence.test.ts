import { describe, expect, it } from "bun:test";
import { detectDivergence } from "../../src/lib/divergence.ts";

const T0 = new Date("2024-01-01T10:00:00Z");
const T1 = new Date("2024-01-01T11:00:00Z");
const T2 = new Date("2024-01-01T12:00:00Z");

describe("detectDivergence", () => {
  it("returns in_sync when neither side has been edited", () => {
    expect(detectDivergence(null, null, null, null)).toBe("in_sync");
  });

  it("returns in_sync when both sides were edited before their respective syncs", () => {
    // this edited at T0, synced at T1; sibling edited at T0, synced at T1
    expect(detectDivergence(T0, T1, T0, T1)).toBe("in_sync");
  });

  it("returns this_newer when this article was edited after its last sync", () => {
    // this edited T2 (after sync T1); sibling not edited
    expect(detectDivergence(T2, T1, null, null)).toBe("this_newer");
  });

  it("returns this_newer when this was edited but never synced", () => {
    expect(detectDivergence(T1, null, null, null)).toBe("this_newer");
  });

  it("returns sibling_newer when sibling was edited after its last sync", () => {
    expect(detectDivergence(null, null, T2, T1)).toBe("sibling_newer");
  });

  it("returns sibling_newer when sibling was edited but never synced", () => {
    expect(detectDivergence(null, null, T1, null)).toBe("sibling_newer");
  });

  it("returns both_diverged when both sides were edited after their respective syncs", () => {
    // this edited T2, synced T1; sibling edited T2, synced T0
    expect(detectDivergence(T2, T1, T2, T0)).toBe("both_diverged");
  });

  it("returns both_diverged when both sides were edited but neither ever synced", () => {
    expect(detectDivergence(T1, null, T1, null)).toBe("both_diverged");
  });

  it("returns in_sync when thisLastEdited equals thisLastSync exactly", () => {
    // edited at T1, synced at T1 — not strictly greater, so not diverged
    expect(detectDivergence(T1, T1, null, null)).toBe("in_sync");
  });

  it("returns this_newer when thisLastEdited is one millisecond after sync", () => {
    const syncTime = new Date(T1.getTime());
    const editTime = new Date(T1.getTime() + 1);
    expect(detectDivergence(editTime, syncTime, null, null)).toBe("this_newer");
  });
});
