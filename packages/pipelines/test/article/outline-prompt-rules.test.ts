import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

// Spec 64.6 regression: Rule 6 ("Hero image") must explicitly forbid text labels.
// The prompt is built inline inside OutlineStep.execute() using runtime values
// (cornerstoneKeyword, clusterName, etc.) so we can't pull it from a pure helper —
// assert against the source file text directly. Brittle but cheap and catches
// the exact regression we're guarding against: any future edit that re-introduces
// "text labels are allowed" wording or downgrades the AVOID list will fail here.

const OUTLINE_SOURCE = readFileSync(
  join(import.meta.dir, "..", "..", "src", "article", "steps", "outline.ts"),
  "utf8"
);

describe("OutlineStep hero-image rule (Spec 64.6)", () => {
  it("system prompt explicitly forbids text labels", () => {
    expect(OUTLINE_SOURCE).toContain("NO text labels of any kind");
    expect(OUTLINE_SOURCE).not.toContain("Short text labels (1-3 words) ARE allowed");
  });

  it("model reference updated from Flux 1.1 Pro to Nano Banana 2", () => {
    expect(OUTLINE_SOURCE).toContain("Nano Banana 2");
    // The literal Rule 6 header must not still call out Flux 1.1 Pro
    expect(OUTLINE_SOURCE).not.toContain("highly specific prompt for Flux 1.1 Pro");
  });

  it("AVOID list covers typography / signage / readable writing", () => {
    expect(OUTLINE_SOURCE).toContain("typography");
    expect(OUTLINE_SOURCE).toContain("signage");
    expect(OUTLINE_SOURCE).toContain("readable writing");
  });

  it("offers symbolic alternatives instead of rendered text", () => {
    // Rule 6 must explain HOW to convey hierarchy without text
    expect(OUTLINE_SOURCE).toMatch(/shape, color, position, or symbolic icons/);
  });
});
