import { describe, it, expect } from "bun:test";
import { deriveDsTokens } from "../src/brand-tokens/derive";
import { toolwikiBrandTokens, orangeBrandTokens } from "../src/brand-tokens/derive.fixtures";

describe("deriveDsTokens", () => {
  it("derives 7 brand stops from brandHue", () => {
    const t = deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(t.brand[500]).toBe("oklch(64% 0.160 248)");
    expect(t.brand[300]).toBe("oklch(80% 0.100 248)");
    expect(t.brand[700]).toBe("oklch(48% 0.140 248)");
  });

  it("hue change affects every brand stop", () => {
    const a = deriveDsTokens(toolwikiBrandTokens, "dark");
    const b = deriveDsTokens(orangeBrandTokens, "dark");
    expect(a.brand[500]).not.toBe(b.brand[500]);
    expect(b.brand[500]).toContain("30");
  });

  it("surface differs between dark and light", () => {
    const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
    const light = deriveDsTokens(toolwikiBrandTokens, "light");
    expect(dark.surface.base).toBe(toolwikiBrandTokens.colors.surfaceDark);
    expect(light.surface.base).toBe(toolwikiBrandTokens.colors.surface);
  });

  it("shadows present only in light", () => {
    const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
    const light = deriveDsTokens(toolwikiBrandTokens, "light");
    expect(dark.shadows.sm).toBe("none");
    expect(light.shadows.sm).toContain("oklch");
  });

  it("info follows brand", () => {
    const t = deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(t.semantic.info).toBe(t.brand[500]);
  });

  it("does not mutate input", () => {
    const snapshot = JSON.parse(JSON.stringify(toolwikiBrandTokens));
    deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(toolwikiBrandTokens).toEqual(snapshot);
  });
});
