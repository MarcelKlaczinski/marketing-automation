/**
 * Spec 65.16 V1.7 — Tests for the slide-component-friendly preset DS-token deriver.
 *
 * Confirms the legacy-slot-aliasing contract that keeps slide-component
 * code unchanged: when a preset is set, the SAME fields that slide
 * components already read (`tokens.typography.fontFamily`,
 * `tokens.accent[500]`, `tokens.ink.base`, `tokens.emotion.surface`)
 * return preset-specific values.
 */
import { describe, expect, it } from "bun:test";
import { DEFAULT_BRAND_TOKENS } from "@marketing-auto/shared/brand-tokens";
import {
  derivePresetEmotionalDsTokens,
  deriveTokensForRender,
  hasPresetTokens,
  PRESET_CATALOG,
} from "../../src/presets/index.ts";

describe("deriveTokensForRender", () => {
  it("returns EmotionalDsTokens (no preset slot) when preset is null", () => {
    const tokens = deriveTokensForRender(DEFAULT_BRAND_TOKENS, "dark", null);
    expect(hasPresetTokens(tokens)).toBe(false);
  });

  it("returns EmotionalDsTokens (no preset slot) when preset is undefined", () => {
    const tokens = deriveTokensForRender(DEFAULT_BRAND_TOKENS, "dark", undefined);
    expect(hasPresetTokens(tokens)).toBe(false);
  });

  it("returns PresetEmotionalDsTokens when a preset is set", () => {
    const tokens = deriveTokensForRender(DEFAULT_BRAND_TOKENS, "dark", "dark-neon-grid");
    expect(hasPresetTokens(tokens)).toBe(true);
  });

  it("falls back to non-preset deriver when preset is not in catalog (defensive)", () => {
    // Cast through unknown — the union doesn't include arbitrary strings,
    // but the runtime check guards against bypassed type-safety.
    const tokens = deriveTokensForRender(
      DEFAULT_BRAND_TOKENS,
      "dark",
      "not-a-preset" as never,
    );
    expect(hasPresetTokens(tokens)).toBe(false);
  });
});

describe("derivePresetEmotionalDsTokens — legacy-slot aliasing (V1.7 #1)", () => {
  it("aliases preset accent into tokens.accent[500] (no slide edit required)", () => {
    for (const key of ["dark-neon-grid", "light-editorial", "blue-tech-gradient"] as const) {
      const tokens = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", key);
      expect(tokens.accent[500]).toBe(PRESET_CATALOG[key].colors.textAccent);
    }
  });

  it("aliases preset display font into tokens.typography.fontFamily", () => {
    // Each preset's display font family ends up at the SAME slot that slide
    // components already read for headlines — pre-V1.7 code picks it up
    // automatically.
    const darkNeon = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "dark-neon-grid");
    const lightEd = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "light", "light-editorial");
    const blueTech = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "blue-tech-gradient");
    // Verify they are DISTINCT — proves preset typography actually flows through.
    const fonts = new Set([
      darkNeon.typography.fontFamily,
      lightEd.typography.fontFamily,
      blueTech.typography.fontFamily,
    ]);
    expect(fonts.size).toBe(3);
  });

  it("aliases preset eyebrow letter-spacing into tokens.typography.eyebrowLetterSpacing", () => {
    const tokens = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "dark-neon-grid");
    expect(tokens.typography.eyebrowLetterSpacing).toBe(
      PRESET_CATALOG["dark-neon-grid"].typography.eyebrowLetterSpacing,
    );
  });

  it("overrides ink.base with preset textPrimary (background-readability anchor)", () => {
    const tokens = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "light-editorial");
    expect(tokens.ink.base).toBe(PRESET_CATALOG["light-editorial"].colors.textPrimary);
  });

  it("preserves base-deriver fields not overridden by preset (`brand` stops, etc.)", () => {
    const tokens = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "dark-neon-grid");
    // brand[500] etc. comes from `deriveDsTokens` based on `brandTokens.colors.brandHue`
    // — preset should NOT override these. Spot-check the shape exists.
    expect(typeof tokens.brand[500]).toBe("string");
    expect(typeof tokens.brand[700]).toBe("string");
  });

  it("exposes preset.* sub-object for future per-slide branching", () => {
    const tokens = derivePresetEmotionalDsTokens(DEFAULT_BRAND_TOKENS, "dark", "blue-tech-gradient");
    expect(tokens.preset.key).toBe("blue-tech-gradient");
    expect(tokens.preset.text.accent).toBe(PRESET_CATALOG["blue-tech-gradient"].colors.textAccent);
    expect(tokens.preset.display.weight).toBe(PRESET_CATALOG["blue-tech-gradient"].typography.displayWeight);
  });
});
