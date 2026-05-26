/**
 * Spec 65.8 Day 5 — caption-attribution integration smoke tests.
 *
 * Validates the `buildCaptionAttribution` helper (re-exported from
 * `@marketing-auto/social/photographic`) behaves correctly across the
 * Family-B render scenarios. The actual append-site is `RenderSlidesStep`
 * (steps.ts `resolveCaptionAttribution`) — these tests pin the underlying
 * helper's contract so the integration stays stable.
 */
import { describe, expect, it } from "bun:test";
import {
  buildCaptionAttribution,
  type FamilyBImageEntry,
} from "@marketing-auto/social/photographic";

function entry(
  provider: "pexels" | "unsplash" | "pixabay",
  photographer: string | null,
  slideIndex: number,
): FamilyBImageEntry {
  return {
    slideIndex,
    r2Key: `key-${slideIndex}`,
    r2Url: `https://cdn.example.com/key-${slideIndex}`,
    originalR2Key: null,
    license: {
      provider,
      photographer,
      sourceUrl: `https://${provider}.test/photo/${slideIndex}`,
    },
    queryUsed: "test",
    cachedAt: "2026-05-26T00:00:00.000Z",
  };
}

describe("Caption attribution integration", () => {
  it("returns null when no images need attribution (all-Pixabay carousel)", () => {
    const suffix = buildCaptionAttribution([
      entry("pixabay", "user1", 0),
      entry("pixabay", "user2", 1),
    ]);
    expect(suffix).toBeNull();
  });

  it("returns null on empty array", () => {
    expect(buildCaptionAttribution([])).toBeNull();
  });

  it("emits Unsplash credit with proper brand wording (TOS-compliant)", () => {
    const suffix = buildCaptionAttribution([entry("unsplash", "Jane Doe", 0)]);
    expect(suffix).toBe("📸 Photos: Jane Doe on Unsplash");
  });

  it("emits Pexels credit when photographer name is present (optional)", () => {
    const suffix = buildCaptionAttribution([entry("pexels", "Bob Smith", 0)]);
    expect(suffix).toBe("📸 Photos: Bob Smith on Pexels");
  });

  it("dedupes identical credits across slides", () => {
    const suffix = buildCaptionAttribution([
      entry("unsplash", "Jane Doe", 0),
      entry("unsplash", "Jane Doe", 2),
      entry("unsplash", "Jane Doe", 4),
    ]);
    expect(suffix).toBe("📸 Photos: Jane Doe on Unsplash");
  });

  it("mixes Pexels + Unsplash credits in one line (Pixabay omitted)", () => {
    const suffix = buildCaptionAttribution([
      entry("unsplash", "Jane Doe", 0),
      entry("pixabay", "anon", 1),
      entry("pexels", "Bob Smith", 2),
      entry("unsplash", "Carol Lee", 3),
    ]);
    expect(suffix).toBe("📸 Photos: Jane Doe on Unsplash, Bob Smith on Pexels, Carol Lee on Unsplash");
  });

  it("skips Unsplash entries with null photographer (defensive)", () => {
    const suffix = buildCaptionAttribution([entry("unsplash", null, 0)]);
    expect(suffix).toBeNull();
  });

  it("produces a suffix that can be appended without conflicts to a normal caption", () => {
    const caption = "Mein Top-Pick für 2026: Claude.\n\nLink in Bio → toolwiki.ai/x";
    const suffix = buildCaptionAttribution([entry("unsplash", "Jane Doe", 0)]);
    if (suffix === null) throw new Error("expected suffix");
    const finalCaption = `${caption}\n\n${suffix}`;
    expect(finalCaption).toContain("Mein Top-Pick");
    expect(finalCaption).toContain("Link in Bio");
    expect(finalCaption).toContain("Jane Doe on Unsplash");
    expect(finalCaption.length).toBeLessThan(2200); // Instagram caption hard limit
  });
});
