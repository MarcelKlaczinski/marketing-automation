/**
 * Spec multi-domain-evolution S2.4 — coverage for the 5 Toolwiki extras
 * schemas. Comparison + ki-wissen schemas migrated from the pipelines
 * package preserve identical behaviour (regression: existing pipeline
 * tests still pass). Blog + tools + usecases are new schemas derived
 * from the Phase-1 discovery inventory.
 */
import { describe, expect, it } from "bun:test";
import {
  ComparisonExtrasSchema,
  BlogExtrasSchema,
  UsecasesExtrasSchema,
  validateComparisonExtras,
  validateKiWissenExtras,
  validateBlogExtras,
  validateToolsExtras,
  validateUsecasesExtras,
} from "../src/domains/toolwiki/index.ts";

describe("ComparisonExtras (migration regression)", () => {
  it("accepts a 2-tool comparison with a tool-a winner", () => {
    const r = validateComparisonExtras({
      toolSlugs: ["chatgpt", "claude"],
      winner: "tool-a",
      verdict: "ChatGPT wins on plugin breadth despite Claude's stronger reasoning.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.toolSlugs).toHaveLength(2);
      expect(r.data.winner).toBe("tool-a");
    }
  });

  it("rejects `winner: depends` without useCaseVerdicts", () => {
    const r = validateComparisonExtras({
      toolSlugs: ["chatgpt", "claude"],
      winner: "depends",
      verdict: "It depends on the task — see use-case-specific verdicts below.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("useCaseVerdict");
  });

  it("accepts `winner: depends` WITH useCaseVerdicts", () => {
    const r = validateComparisonExtras({
      toolSlugs: ["chatgpt", "claude"],
      winner: "depends",
      verdict: "Picks shift by workflow — see verdicts.",
      useCaseVerdicts: [
        { useCase: "Code refactoring", winner: "Claude", reason: "Better long-context follow-through." },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects toolSlugs out of range", () => {
    const single = ComparisonExtrasSchema.safeParse({
      toolSlugs: ["only-one"],
      winner: "tool-a",
      verdict: "Single-tool case — should fail.",
    });
    expect(single.success).toBe(false);
  });
});

describe("KiWissenExtras (migration regression)", () => {
  it("accepts a valid Grundlagen pillar", () => {
    const r = validateKiWissenExtras({
      category: "Grundlagen",
      level: "Einsteiger",
      icon: "BookOpen",
      facts: ["Fakt 1.", "Fakt 2.", "Fakt 3."],
      next: ["Erstes Folgethema", "Zweites Folgethema"],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects Pattern-116 monetization fields", () => {
    const r = validateKiWissenExtras({
      category: "Grundlagen",
      level: "Einsteiger",
      icon: "BookOpen",
      facts: ["alpha", "beta", "gamma"],
      next: ["delta", "epsilon"],
      adsenseSlots: ["top"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("adsenseSlots");
  });

  it("rejects hasAffiliateLinks=true", () => {
    const r = validateKiWissenExtras({
      category: "Grundlagen",
      level: "Einsteiger",
      icon: "BookOpen",
      facts: ["alpha", "beta", "gamma"],
      next: ["delta", "epsilon"],
      hasAffiliateLinks: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("hasAffiliateLinks");
  });

  it("rejects facts array shorter than 3", () => {
    const r = validateKiWissenExtras({
      category: "Praxis",
      level: "Profi",
      icon: "Settings",
      facts: ["only one"],
      next: ["a", "b"],
    });
    expect(r.ok).toBe(false);
  });
});

describe("BlogExtras (new schema)", () => {
  it("accepts all 9 intent types from Spec 64.14", () => {
    for (const intent of [
      "overview",
      "pricing",
      "features",
      "use-cases",
      "comparison",
      "tutorial",
      "review",
      "ethics",
      "general",
    ]) {
      const r = validateBlogExtras({ intentType: intent });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects an unknown intentType", () => {
    const r = validateBlogExtras({ intentType: "wirtschaftlichkeit" });
    expect(r.ok).toBe(false);
  });

  it("accepts an empty extras object (all fields optional)", () => {
    const r = validateBlogExtras({});
    expect(r.ok).toBe(true);
  });

  it("accepts showTopicLinks boolean + primaryTool slug", () => {
    const r = BlogExtrasSchema.safeParse({
      showTopicLinks: false,
      primaryTool: "claude",
    });
    expect(r.success).toBe(true);
  });
});

describe("ToolsExtras (new schema)", () => {
  it("accepts a full tool review extras blob", () => {
    const r = validateToolsExtras({
      features: ["Code completion", "Refactoring assistance"],
      pros: ["Fast", "Accurate"],
      cons: ["Pricey for solo devs"],
      useCases: ["Mid-size codebase refactors"],
      integrations: ["VS Code", "JetBrains"],
      pricing: "freemium",
      priceFrom: 20,
      rating: 4.5,
      votes: 1200,
      affiliateSlug: "cursor",
      website: "https://cursor.sh",
      relatedPillars: ["was-ist-ki", "prompt-engineering"],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects rating > 5", () => {
    const r = validateToolsExtras({ rating: 6 });
    expect(r.ok).toBe(false);
  });

  it("rejects negative priceFrom", () => {
    const r = validateToolsExtras({ priceFrom: -10 });
    expect(r.ok).toBe(false);
  });

  it("accepts a free-form pricing string (no enum)", () => {
    // Phase-1 finding: pricing is freetext in Toolwiki (`'freemium'`,
    // `'api-based'`, `'from $20/mo'`). Loosely typed by design.
    for (const pricing of ["freemium", "api-based", "from $20/mo", "enterprise"]) {
      expect(validateToolsExtras({ pricing }).ok).toBe(true);
    }
  });

  it("loosens relatedPillars from the pre-spec hardcoded enum to free strings", () => {
    // Phase-1 E1 + Spec multi-domain-evolution: relatedPillars used to be a
    // hardcoded 12-Toolwiki-pillar enum. S2.4 loosens to string so other
    // tenants can use their own pillar set.
    const r = validateToolsExtras({ relatedPillars: ["future-tenant-pillar"] });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-URL website", () => {
    const r = validateToolsExtras({ website: "not-a-url" });
    expect(r.ok).toBe(false);
  });
});

describe("UsecasesExtras (new schema)", () => {
  it("accepts all 4 contentType values", () => {
    for (const ct of ["stub", "expanded", "pillar", "hub"]) {
      const r = validateUsecasesExtras({ contentType: ct });
      expect(r.ok).toBe(true);
    }
  });

  it("rejects featuredToolSlugs below the 2-item minimum", () => {
    const r = validateUsecasesExtras({ featuredToolSlugs: ["only-one"] });
    expect(r.ok).toBe(false);
  });

  it("accepts a 7-slug array (top of the range)", () => {
    const r = validateUsecasesExtras({
      featuredToolSlugs: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a 8th slug (above the range)", () => {
    const r = UsecasesExtrasSchema.safeParse({
      featuredToolSlugs: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    expect(r.success).toBe(false);
  });
});
