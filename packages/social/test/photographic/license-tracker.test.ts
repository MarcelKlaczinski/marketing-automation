/**
 * Spec 65.8 — license-tracker unit tests (pure helpers, no I/O).
 */
import { describe, expect, it } from "bun:test";
import {
  buildCaptionAttribution,
  licenseFromProvider,
  requiresAttribution,
} from "../../src/photographic/license-tracker.ts";
import type { FamilyBImageEntry } from "../../src/photographic/types.ts";

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
    license: { provider, photographer, sourceUrl: `https://${provider}.test/photo/${slideIndex}` },
    queryUsed: "test query",
    cachedAt: "2026-05-26T00:00:00.000Z",
  };
}

describe("requiresAttribution", () => {
  it("flags Unsplash as required", () => {
    expect(requiresAttribution("unsplash")).toBe(true);
  });

  it("flags Pexels + Pixabay as optional", () => {
    expect(requiresAttribution("pexels")).toBe(false);
    expect(requiresAttribution("pixabay")).toBe(false);
  });
});

describe("licenseFromProvider", () => {
  it("builds the license shape from provider + photographer + sourceUrl", () => {
    const license = licenseFromProvider({
      provider: "unsplash",
      photographer: "Jane Doe",
      sourceUrl: "https://unsplash.com/photos/abc",
    });
    expect(license).toEqual({
      provider: "unsplash",
      photographer: "Jane Doe",
      sourceUrl: "https://unsplash.com/photos/abc",
    });
  });

  it("preserves null photographer for Pixabay anonymous hits", () => {
    const license = licenseFromProvider({
      provider: "pixabay",
      photographer: null,
      sourceUrl: "https://pixabay.com/photos/abc",
    });
    expect(license.photographer).toBeNull();
  });
});

describe("buildCaptionAttribution", () => {
  it("returns null when all images are Pixabay (no attribution needed)", () => {
    const result = buildCaptionAttribution([
      entry("pixabay", "User1", 0),
      entry("pixabay", null, 1),
    ]);
    expect(result).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(buildCaptionAttribution([])).toBeNull();
  });

  it("credits Unsplash photographers with the Unsplash brand label", () => {
    const result = buildCaptionAttribution([entry("unsplash", "Jane Doe", 0)]);
    expect(result).toBe("📸 Photos: Jane Doe on Unsplash");
  });

  it("credits Pexels photographers when present", () => {
    const result = buildCaptionAttribution([entry("pexels", "Bob Smith", 0)]);
    expect(result).toBe("📸 Photos: Bob Smith on Pexels");
  });

  it("dedups identical credits across slides", () => {
    const result = buildCaptionAttribution([
      entry("unsplash", "Jane Doe", 0),
      entry("unsplash", "Jane Doe", 2),
    ]);
    expect(result).toBe("📸 Photos: Jane Doe on Unsplash");
  });

  it("mixes Pexels + Unsplash credits in one line", () => {
    const result = buildCaptionAttribution([
      entry("unsplash", "Jane Doe", 0),
      entry("pixabay", "anon", 1), // not credited (Pixabay)
      entry("pexels", "Bob Smith", 2),
    ]);
    expect(result).toBe("📸 Photos: Jane Doe on Unsplash, Bob Smith on Pexels");
  });

  it("skips Unsplash entries with null photographer (defensive — should not happen)", () => {
    const result = buildCaptionAttribution([entry("unsplash", null, 0)]);
    expect(result).toBeNull();
  });
});
