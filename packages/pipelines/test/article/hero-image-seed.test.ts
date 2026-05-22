import { describe, expect, it } from "bun:test";
import { seedFromArticleId } from "../../src/article/steps/hero-image.ts";

// Spec 64.6: hash-derived seed must be deterministic so reruns of the same
// articleId produce the same image-generation seed (enables editorial A/B via
// UI re-roll with seed+1 in a future PR).

describe("seedFromArticleId (Spec 64.6)", () => {
  it("returns the same non-negative integer seed for the same articleId", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const seed1 = seedFromArticleId(id);
    const seed2 = seedFromArticleId(id);
    expect(seed1).toBe(seed2);
    expect(seed1).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(seed1)).toBe(true);
  });

  it("returns different seeds for different articleIds", () => {
    const a = seedFromArticleId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const b = seedFromArticleId("ffffffff-1111-2222-3333-444444444444");
    expect(a).not.toBe(b);
  });

  it("survives shorter / longer inputs without throwing", () => {
    expect(() => seedFromArticleId("")).not.toThrow();
    expect(() => seedFromArticleId("x")).not.toThrow();
    expect(() => seedFromArticleId("a".repeat(200))).not.toThrow();
    expect(seedFromArticleId("")).toBe(0); // empty hash stays at 0
  });

  it("returns a value within JS 32-bit signed-int positive range", () => {
    const seed = seedFromArticleId("test-article-id-for-bounds");
    expect(seed).toBeLessThanOrEqual(2 ** 31);
  });
});
