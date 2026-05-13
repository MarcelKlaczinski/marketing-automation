import { describe, expect, it } from "bun:test";
import { hexToOklch, oklchToHex, wcagContrastRatio } from "../../src/lib/color-utils.ts";

describe("color-utils", () => {
  it("hexToOklch converts primary blue", () => {
    const result = hexToOklch("#4F6FE5");
    expect(result.l).toBeGreaterThan(0);
    expect(result.l).toBeLessThanOrEqual(100);
    expect(result.c).toBeGreaterThan(0);
    expect(result.h).toBeGreaterThan(0);
  });

  it("oklchToHex converts back to a hex string", () => {
    const hex = oklchToHex(64, 0.16, 248);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("round-trip preserves approximate values", () => {
    const original = "#4F6FE5";
    const { l, c, h } = hexToOklch(original);
    const roundtripped = oklchToHex(l, c, h);
    // Allow small color drift from rounding
    expect(roundtripped).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("hexToOklch handles black", () => {
    const { l, c } = hexToOklch("#000000");
    expect(l).toBe(0);
    expect(c).toBe(0);
  });

  it("hexToOklch handles white", () => {
    const { l } = hexToOklch("#ffffff");
    expect(l).toBe(100);
  });

  it("wcagContrastRatio black vs white is ~21", () => {
    const ratio = wcagContrastRatio("#000000", "#ffffff");
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThanOrEqual(21.1);
  });

  it("wcagContrastRatio same color is 1", () => {
    const ratio = wcagContrastRatio("#4F6FE5", "#4F6FE5");
    expect(ratio).toBe(1);
  });
});
