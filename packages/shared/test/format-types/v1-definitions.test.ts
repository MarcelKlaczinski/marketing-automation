/**
 * Spec 65.4 — Per-format-type config schema + definition unit tests.
 *
 * Asserts each of the 5 v1 format-types validates expected configs, rejects
 * malformed ones, and exposes the right `family` / `needsHooks` / `eligibleTemplates`
 * shape. Grouped into one file (vs the spec's 5-file sketch) because each
 * schema is small and the assertions are highly parallel.
 */
import { describe, expect, it } from "bun:test";
import {
  FORMAT_TYPES,
  headToHeadConfigSchema,
  headToHeadDefinition,
  lifestyleListicleConfigSchema,
  lifestyleListicleDefinition,
  opinionRecommendationConfigSchema,
  opinionRecommendationDefinition,
  storyArcClickbaitConfigSchema,
  storyArcClickbaitDefinition,
  topNComparisonConfigSchema,
  topNComparisonDefinition,
  validateFormatConfig,
} from "../../src/format-types/index.ts";

const FAKE_UUID = "11111111-2222-3333-4444-555555555555";
const FAKE_UUID_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

describe("top_n_comparison (Family A)", () => {
  it("definition has needsHooks=false + canonical end-slides", () => {
    expect(topNComparisonDefinition.family).toBe("A");
    expect(topNComparisonDefinition.needsHooks).toBe(false);
    expect(topNComparisonDefinition.defaultEndSlides).toEqual(["comment-to-get", "link-in-bio"]);
    expect(topNComparisonDefinition.eligibleTemplates).toContain("comparison-grid-3");
    expect(topNComparisonDefinition.eligibleTemplates).toContain("comparison-grid-5");
  });

  it("applies defaults for topN, rankingSource, excludeRecentlyUsed", () => {
    const r = topNComparisonConfigSchema.parse({ categorySlug: "ai-image-generation" });
    expect(r.topN).toBe(5);
    expect(r.rankingSource).toBe("llm-curated");
    expect(r.excludeRecentlyUsed).toBe(true);
  });

  it("rejects topN < 3 and topN > 10", () => {
    expect(topNComparisonConfigSchema.safeParse({ categorySlug: "x", topN: 2 }).success).toBe(false);
    expect(topNComparisonConfigSchema.safeParse({ categorySlug: "x", topN: 11 }).success).toBe(false);
  });

  it("rejects empty categorySlug", () => {
    expect(topNComparisonConfigSchema.safeParse({ categorySlug: "" }).success).toBe(false);
  });
});

describe("head_to_head (Family A)", () => {
  it("definition has needsHooks=false + 2 eligible templates", () => {
    expect(headToHeadDefinition.family).toBe("A");
    expect(headToHeadDefinition.needsHooks).toBe(false);
    expect(headToHeadDefinition.eligibleTemplates).toEqual([
      "head-to-head-vs",
      "comparison-grid-3",
    ]);
  });

  it("accepts two UUIDs with optional angleHint", () => {
    const r = headToHeadConfigSchema.parse({ toolAId: FAKE_UUID, toolBId: FAKE_UUID_B });
    expect(r.toolAId).toBe(FAKE_UUID);
    expect(r.angleHint).toBeUndefined();
  });

  it("rejects non-uuid toolAId/toolBId", () => {
    expect(headToHeadConfigSchema.safeParse({ toolAId: "not-a-uuid", toolBId: FAKE_UUID_B }).success).toBe(false);
    expect(headToHeadConfigSchema.safeParse({ toolAId: FAKE_UUID, toolBId: "nope" }).success).toBe(false);
  });
});

describe("story_arc_clickbait (Family B)", () => {
  it("definition has needsHooks=true (Family B always needs hooks)", () => {
    expect(storyArcClickbaitDefinition.family).toBe("B");
    expect(storyArcClickbaitDefinition.needsHooks).toBe(true);
  });

  it("applies narrativeAngle + toneIntensity defaults", () => {
    const r = storyArcClickbaitConfigSchema.parse({
      professionPool: ["Texter"],
      toolToFeature: FAKE_UUID,
    });
    expect(r.narrativeAngle).toBe("career-disruption");
    expect(r.toneIntensity).toBe("dramatic");
  });

  it("rejects empty professionPool", () => {
    expect(
      storyArcClickbaitConfigSchema.safeParse({
        professionPool: [],
        toolToFeature: FAKE_UUID,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown narrativeAngle value", () => {
    const r = storyArcClickbaitConfigSchema.safeParse({
      professionPool: ["Texter"],
      toolToFeature: FAKE_UUID,
      narrativeAngle: "doomscroll-funnel",
    });
    expect(r.success).toBe(false);
  });
});

describe("lifestyle_listicle (Family B)", () => {
  it("definition has needsHooks=true + single eligible template", () => {
    // Spec 65.cleanup: V1 ships ONE template per Family-B format-type with a
    // toneIntensity config-knob; the planned -dramatic / -minimal variants
    // were V1-cut per Spec 65.7 Day 4 §16.
    expect(lifestyleListicleDefinition.family).toBe("B");
    expect(lifestyleListicleDefinition.needsHooks).toBe(true);
    expect(lifestyleListicleDefinition.eligibleTemplates).toEqual(["lifestyle-listicle"]);
  });

  it("applies itemCount default + accepts optional toolFilter", () => {
    const r = lifestyleListicleConfigSchema.parse({ lifeArea: "Studium" });
    expect(r.itemCount).toBe(5);
    expect(r.toolFilter).toBeUndefined();

    const r2 = lifestyleListicleConfigSchema.parse({
      lifeArea: "Familie",
      toolFilter: { categorySlugs: ["ai-image-generation"], personaFilter: "freelance-parent" },
    });
    expect(r2.toolFilter?.categorySlugs).toEqual(["ai-image-generation"]);
  });

  it("rejects empty lifeArea", () => {
    expect(lifestyleListicleConfigSchema.safeParse({ lifeArea: "" }).success).toBe(false);
  });
});

describe("opinion_recommendation (Family B)", () => {
  it("definition has needsHooks=true + affiliate end-slides", () => {
    expect(opinionRecommendationDefinition.family).toBe("B");
    expect(opinionRecommendationDefinition.needsHooks).toBe(true);
    expect(opinionRecommendationDefinition.defaultEndSlides).toContain("link-in-bio");
  });

  it("applies opinionStance + affiliateAngle defaults", () => {
    const r = opinionRecommendationConfigSchema.parse({ recommendedToolId: FAKE_UUID });
    expect(r.opinionStance).toBe("enthusiastic");
    expect(r.affiliateAngle).toBe(true);
  });

  it("rejects non-uuid recommendedToolId", () => {
    expect(opinionRecommendationConfigSchema.safeParse({ recommendedToolId: "x" }).success).toBe(false);
  });
});

describe("registry integration (Spec 65.4)", () => {
  it("validateFormatConfig routes top_n_comparison through the registered schema", () => {
    const ok = validateFormatConfig("top_n_comparison", {
      categorySlug: "ai-image-generation",
    });
    expect(ok.ok).toBe(true);
  });

  it("validateFormatConfig rejects malformed head_to_head config", () => {
    const bad = validateFormatConfig("head_to_head", { toolAId: "not-uuid", toolBId: "x" });
    expect(bad.ok).toBe(false);
  });

  it("Family-A definitions all have needsHooks=false; Family-B definitions all have needsHooks=true", () => {
    expect(FORMAT_TYPES.top_n_comparison?.needsHooks).toBe(false);
    expect(FORMAT_TYPES.head_to_head?.needsHooks).toBe(false);
    expect(FORMAT_TYPES.story_arc_clickbait?.needsHooks).toBe(true);
    expect(FORMAT_TYPES.lifestyle_listicle?.needsHooks).toBe(true);
    expect(FORMAT_TYPES.opinion_recommendation?.needsHooks).toBe(true);
  });

  it("every v1 definition has at least one eligibleTemplate + at least one defaultEndSlide", () => {
    for (const key of [
      "top_n_comparison",
      "head_to_head",
      "story_arc_clickbait",
      "lifestyle_listicle",
      "opinion_recommendation",
    ] as const) {
      const def = FORMAT_TYPES[key];
      expect(def).toBeDefined();
      expect(def!.eligibleTemplates.length).toBeGreaterThan(0);
      expect(def!.defaultEndSlides.length).toBeGreaterThan(0);
    }
  });
});
