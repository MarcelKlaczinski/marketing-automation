import { describe, expect, it } from "bun:test";
import { estimateHeroImageCost } from "@marketing-auto/core/cost";

describe("estimateHeroImageCost (Spec 64.6b)", () => {
  it("returns 1K nano-banana-2 cost for default Toolwiki project", () => {
    // $0.067 × 0.92 EUR/USD ≈ €0.0616
    expect(estimateHeroImageCost("nano-banana-2", "1k")).toBeCloseTo(0.0616, 3);
  });

  it("returns 2K nano-banana-2 cost for premium project", () => {
    // $0.101 × 0.92 ≈ €0.0929
    expect(estimateHeroImageCost("nano-banana-2", "2k")).toBeCloseTo(0.0929, 3);
  });

  it("returns 4K nano-banana-2 cost for print-quality project", () => {
    // $0.151 × 0.92 ≈ €0.1389
    expect(estimateHeroImageCost("nano-banana-2", "4k")).toBeCloseTo(0.1389, 3);
  });

  it("returns nano-banana-pro 1K rate for pro provider at 1K", () => {
    // $0.134 × 0.92 ≈ €0.1233
    expect(estimateHeroImageCost("nano-banana-pro", "1k")).toBeCloseTo(0.1233, 3);
  });

  it("returns Flux fallback rate when provider is flux-1.1-pro (resolution ignored)", () => {
    // $0.04 × 0.92 = €0.0368 for both '1k' and '4k' because Flux only generates 1K natively.
    expect(estimateHeroImageCost("flux-1.1-pro", "1k")).toBeCloseTo(0.0368, 3);
    expect(estimateHeroImageCost("flux-1.1-pro", "4k")).toBeCloseTo(0.0368, 3);
  });
});
