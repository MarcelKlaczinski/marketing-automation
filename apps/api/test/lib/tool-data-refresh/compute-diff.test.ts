/**
 * Spec 65.3 — pure unit tests for the diff helper. No DB, no I/O.
 */
import { describe, expect, it } from "bun:test";
import {
  computeToolDataDiff,
  featureFingerprint,
  pricingFingerprint,
} from "../../../src/lib/tool-data-refresh/compute-diff.ts";
import type { ToolDataExtract } from "../../../src/lib/tool-data-refresh/extract-tool-data.ts";

const baseExtract: ToolDataExtract = {
  pricing: {
    hasFreeTier: true,
    cheapestPaidEur: 19,
    paidTierNames: ["Pro"],
    billingModel: "monthly",
  },
  features: {
    apiAccess: true,
    selfHosted: false,
    recentMajorFeatures: null,
  },
  materialChangeJudgment: {
    isMaterial: false,
    reasoning: "No material change detected.",
    summary: null,
  },
  sources: ["https://example.com/pricing"],
};

describe("computeToolDataDiff", () => {
  it("flags material=true when the LLM judgment says so", () => {
    const extract: ToolDataExtract = {
      ...baseExtract,
      materialChangeJudgment: {
        isMaterial: true,
        reasoning: "Free tier removed.",
        summary: "Free tier removed; lowest paid is €19.",
      },
    };
    const diff = computeToolDataDiff({
      extract,
      priorPricingFingerprint: null,
      priorFeatureFingerprint: null,
    });
    expect(diff.materialChange).toBe(true);
    expect(diff.summary).toBe("Free tier removed; lowest paid is €19.");
  });

  it("flags pricingChanged when fingerprint differs from prior", () => {
    const newFp = pricingFingerprint(baseExtract);
    const diff = computeToolDataDiff({
      extract: baseExtract,
      priorPricingFingerprint: "deadbeefdeadbeef",
      priorFeatureFingerprint: featureFingerprint(baseExtract),
    });
    expect(diff.pricingChanged).toBe(true);
    expect(diff.featuresChanged).toBe(false);
    expect(diff.newPricingFingerprint).toBe(newFp);
  });

  it("flags featuresChanged when only feature fingerprint differs", () => {
    const newFeatureFp = featureFingerprint(baseExtract);
    const diff = computeToolDataDiff({
      extract: baseExtract,
      priorPricingFingerprint: pricingFingerprint(baseExtract),
      priorFeatureFingerprint: "feedfacefeedface",
    });
    expect(diff.pricingChanged).toBe(false);
    expect(diff.featuresChanged).toBe(true);
    expect(diff.newFeatureFingerprint).toBe(newFeatureFp);
  });

  it("first-tick fingerprint is always 'changed' from null prior", () => {
    const diff = computeToolDataDiff({
      extract: baseExtract,
      priorPricingFingerprint: null,
      priorFeatureFingerprint: null,
    });
    expect(diff.pricingChanged).toBe(true);
    expect(diff.featuresChanged).toBe(true);
  });

  it("pricing fingerprint is stable across tier-array reordering", () => {
    const a: ToolDataExtract = {
      ...baseExtract,
      pricing: { ...baseExtract.pricing, paidTierNames: ["Pro", "Team"] },
    };
    const b: ToolDataExtract = {
      ...baseExtract,
      pricing: { ...baseExtract.pricing, paidTierNames: ["Team", "Pro"] },
    };
    expect(pricingFingerprint(a)).toBe(pricingFingerprint(b));
  });

  it("feature fingerprint ignores `recentMajorFeatures` free-text noise", () => {
    const a: ToolDataExtract = {
      ...baseExtract,
      features: { ...baseExtract.features, recentMajorFeatures: "Added darkmode" },
    };
    const b: ToolDataExtract = {
      ...baseExtract,
      features: { ...baseExtract.features, recentMajorFeatures: null },
    };
    // Both have apiAccess=true, selfHosted=false → same fingerprint despite
    // different free-text fields. The fingerprint deliberately excludes the
    // free-text field so cosmetic changelog copy doesn't count as "changed".
    expect(featureFingerprint(a)).toBe(featureFingerprint(b));
  });
});
