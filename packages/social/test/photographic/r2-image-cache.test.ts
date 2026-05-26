/**
 * Spec 65.8 — r2-image-cache pure-helper test.
 *
 * `stageProviderImage` itself does I/O (fetch + sharp + R2 upload) and is
 * covered by Day 5 end-to-end pipeline tests when the orchestrator + DI
 * mocks land. For Day 1 we lock down the pure cache-lookup helper that
 * consumers (re-render endpoint, pipeline orchestrator) call before
 * deciding whether to re-stage.
 */
import { describe, expect, it } from "bun:test";
import { findCachedEntryForSlide } from "../../src/photographic/r2-image-cache.ts";
import type { FamilyBImageEntry } from "../../src/photographic/types.ts";

function entry(slideIndex: number): FamilyBImageEntry {
  return {
    slideIndex,
    r2Key: `key-${slideIndex}`,
    r2Url: `https://cdn.example.com/key-${slideIndex}.webp`,
    originalR2Key: null,
    license: {
      provider: "pexels",
      photographer: "Test",
      sourceUrl: `https://www.pexels.com/photo/${slideIndex}/`,
    },
    queryUsed: "query",
    cachedAt: "2026-05-26T00:00:00.000Z",
  };
}

describe("findCachedEntryForSlide", () => {
  it("returns the entry matching the slideIndex", () => {
    const entries = [entry(0), entry(3), entry(5)];
    expect(findCachedEntryForSlide(entries, 3)?.r2Key).toBe("key-3");
  });

  it("returns undefined when no entry matches", () => {
    const entries = [entry(0), entry(3)];
    expect(findCachedEntryForSlide(entries, 7)).toBeUndefined();
  });

  it("handles empty array", () => {
    expect(findCachedEntryForSlide([], 0)).toBeUndefined();
  });

  it("returns the FIRST match if duplicates exist (defensive — should not happen)", () => {
    const entries = [
      entry(2),
      { ...entry(2), r2Key: "shadow-key" },
    ];
    expect(findCachedEntryForSlide(entries, 2)?.r2Key).toBe("key-2");
  });
});
