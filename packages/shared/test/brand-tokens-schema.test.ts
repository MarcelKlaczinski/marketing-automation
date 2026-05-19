import { describe, it, expect } from "bun:test";
import { brandTokensSchema, DEFAULT_BRAND_TOKENS } from "../src/brand-tokens/index.ts";

describe("brandTokensSchema", () => {
  it("parses an empty object to defaults", () => {
    const result = brandTokensSchema.parse({});
    expect(result.colors.brandHue).toBe(248);
    expect(result.colors.accentHue).toBe(168);
    expect(result.colors.primary).toBe("oklch(64% 0.16 248)");
    expect(result.colors.accent).toBe("oklch(72% 0.15 168)");
    expect(result.typography.fontFamily).toContain("Inter");
    expect(result.voice.addressForm).toBe("du");
  });

  it("preserves explicit brandHue", () => {
    const result = brandTokensSchema.parse({ colors: { brandHue: 12 } });
    expect(result.colors.brandHue).toBe(12);
  });

  it("strips unknown fields", () => {
    const result = brandTokensSchema.parse({
      colors: { brandHue: 100, totallyMadeUpField: "x" },
    // biome-ignore lint/suspicious/noExplicitAny: test intentionally passes unknown fields
    }) as any;
    expect(result.colors.totallyMadeUpField).toBeUndefined();
  });

  it("rejects out-of-range hue", () => {
    expect(() => brandTokensSchema.parse({ colors: { brandHue: 400 } })).toThrow();
    expect(() => brandTokensSchema.parse({ colors: { accentHue: -1 } })).toThrow();
  });

  it("accepts optional surfaceRaised without requiring it", () => {
    const a = brandTokensSchema.parse({});
    expect(a.colors.surfaceRaised).toBeUndefined();
    const b = brandTokensSchema.parse({ colors: { surfaceRaised: "oklch(99% 0.005 250)" } });
    expect(b.colors.surfaceRaised).toBe("oklch(99% 0.005 250)");
  });

  it("accepts valid addressForm values", () => {
    expect(brandTokensSchema.parse({ voice: { addressForm: "du" } }).voice.addressForm).toBe("du");
    expect(brandTokensSchema.parse({ voice: { addressForm: "Sie" } }).voice.addressForm).toBe("Sie");
  });

  it("rejects invalid addressForm", () => {
    expect(() => brandTokensSchema.parse({ voice: { addressForm: "ihr" } })).toThrow();
  });

  it("fontFamilyMono has a default", () => {
    const result = brandTokensSchema.parse({});
    expect(result.typography.fontFamilyMono).toContain("monospace");
  });

  it("deprecated fields are optional and pass-through when set", () => {
    const result = brandTokensSchema.parse({
      colors: { primaryHue: 100, surfaceSecondary: "oklch(22% 0.02 248)", wikiCream: "#fef9ec" },
    });
    expect(result.colors.primaryHue).toBe(100);
    expect(result.colors.surfaceSecondary).toBe("oklch(22% 0.02 248)");
    expect(result.colors.wikiCream).toBe("#fef9ec");
  });

  it("DEFAULT_BRAND_TOKENS matches schema.parse({})", () => {
    expect(DEFAULT_BRAND_TOKENS).toEqual(brandTokensSchema.parse({}));
  });
});
