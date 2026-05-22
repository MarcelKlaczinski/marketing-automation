import { describe, expect, it } from "bun:test";
import { buildPromptWithResolutionHint } from "../../../src/article/lib/prompt-resolution-hints.ts";

describe("buildPromptWithResolutionHint (Spec 64.6d)", () => {
  it("appends the standard editorial quality hint for '1k' (Toolwiki default)", () => {
    const result = buildPromptWithResolutionHint(
      "Editorial flatlay of a chess piece on cream linen.",
      "1k",
    );
    expect(result).toContain("Editorial flatlay of a chess piece on cream linen.");
    expect(result).toContain("16:9 widescreen aspect ratio");
    expect(result).toContain("standard editorial quality");
  });

  it("appends the high-resolution hint for '2k' (premium)", () => {
    const result = buildPromptWithResolutionHint("Test prompt.", "2k");
    expect(result).toContain("high-resolution editorial photography");
    expect(result).toContain("16:9 widescreen aspect ratio");
  });

  it("appends the premium print-quality hint for '4k'", () => {
    const result = buildPromptWithResolutionHint("Test prompt.", "4k");
    expect(result).toContain("premium print quality");
    expect(result).toContain("ultra-detailed");
  });

  it("appends the low-resolution preview hint for '0.5k'", () => {
    const result = buildPromptWithResolutionHint("Test prompt.", "0.5k");
    expect(result).toContain("low-resolution preview quality");
  });

  it("trims whitespace from the base prompt before appending the Format suffix", () => {
    const result = buildPromptWithResolutionHint("  Test prompt.\n\n  ", "1k");
    expect(result).toMatch(/^Test prompt\.\n\nFormat:/);
  });

  // Regression guard — qualitative phrasing only, no pixel counts (Marcel decision
  // 2026-05-22). Explicit numerics like "1024px" risk being parsed by Gemini as
  // crop/layout hints rather than resolution hints.
  it("does NOT include explicit pixel counts (Spec 64.6d: qualitative hints only)", () => {
    for (const resolution of ["0.5k", "1k", "2k", "4k"] as const) {
      const result = buildPromptWithResolutionHint("Test.", resolution);
      expect(result).not.toMatch(/\d+\s*px/i);
      expect(result).not.toMatch(/\b(512|1024|2048|4096)\b/);
    }
  });
});
