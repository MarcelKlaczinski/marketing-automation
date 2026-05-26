/**
 * Spec 65.8 — Emotional DS-tokens variant tests.
 */
import { describe, expect, it } from "bun:test";
import { DEFAULT_BRAND_TOKENS } from "@marketing-auto/shared/brand-tokens";
import { deriveEmotionalDsTokens } from "../../../../src/compositions/_shared/family-b/ds-tokens-emotional.ts";

describe("deriveEmotionalDsTokens", () => {
  it("returns all base DsTokens fields + the emotional extension", () => {
    const tokens = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    // Base DsTokens shape
    expect(tokens.brand[500]).toBeDefined();
    expect(tokens.accent[500]).toBeDefined();
    expect(tokens.surface.base).toBeDefined();
    expect(tokens.ink.base).toBeDefined();
    expect(tokens.typography.fontFamily).toBeDefined();
    // Emotional extension
    expect(tokens.emotion.primary).toBeDefined();
    expect(tokens.emotion.secondary).toBeDefined();
    expect(tokens.emotion.surface).toBe(tokens.surface.base);
    expect(tokens.emotion.imageOverlay).toContain("color-mix");
    expect(tokens.image.aspectRatio).toBe("4:5");
    expect(tokens.image.defaultOpacity).toBeGreaterThan(0);
    expect(tokens.image.defaultOpacity).toBeLessThan(1);
    expect(tokens.image.gradientOverlay).toContain("linear-gradient");
    expect(tokens.layout.padding).toBe(96);
    expect(tokens.layout.maxTextWidth).toBe(720);
  });

  it("uses a higher brand stop in dark theme for primary surface contrast", () => {
    const dark = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    const light = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "light");
    // Dark uses brand[700] for emotional primary; light uses brand[500].
    expect(dark.emotion.primary).toBe(dark.brand[700]);
    expect(light.emotion.primary).toBe(light.brand[500]);
  });

  it("composes gradient overlay from the active surface", () => {
    const tokens = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    expect(tokens.image.gradientOverlay).toContain(tokens.surface.base);
  });

  it("uses oklch color-mix for the image overlay (Chromium-supported)", () => {
    const tokens = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    expect(tokens.emotion.imageOverlay).toContain("oklch");
    expect(tokens.emotion.imageOverlay).toContain("transparent");
  });

  it("is pure — same input produces same output", () => {
    const a = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    const b = deriveEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark");
    expect(a.emotion.primary).toBe(b.emotion.primary);
    expect(a.image.gradientOverlay).toBe(b.image.gradientOverlay);
  });
});
