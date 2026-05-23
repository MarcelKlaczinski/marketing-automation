import { describe, expect, it } from "bun:test";
import {
  REFRESH_PRESERVED_COLUMNS,
  REFRESH_PRESERVED_EXTRAS_KEYS,
  mergePreservedExtras,
} from "../../../src/article/refresh/preserved-fields.ts";

describe("REFRESH_PRESERVED_COLUMNS", () => {
  it("contains the 5 tool_* promoted columns", () => {
    expect(REFRESH_PRESERVED_COLUMNS).toEqual([
      "toolPricing",
      "toolPriceFrom",
      "toolRating",
      "toolVotes",
      "toolAffiliateSlug",
    ]);
  });
});

describe("REFRESH_PRESERVED_EXTRAS_KEYS", () => {
  it("contains the JSONB-resident editorial fields", () => {
    expect(REFRESH_PRESERVED_EXTRAS_KEYS).toEqual(["featured", "pricingVerifiedAt"]);
  });
});

describe("mergePreservedExtras", () => {
  it("returns undefined when incoming is null (no-write signal)", () => {
    expect(mergePreservedExtras({ featured: true }, null)).toBeUndefined();
    expect(mergePreservedExtras({ featured: true }, undefined)).toBeUndefined();
  });

  it("returns incoming as-is when current is null", () => {
    const incoming = { intentType: "review", featured: false };
    expect(mergePreservedExtras(null, incoming)).toEqual(incoming);
    expect(mergePreservedExtras(undefined, incoming)).toEqual(incoming);
  });

  it("preserves featured=true from current when incoming omits it", () => {
    const current = { featured: true, category: "old-cat" };
    const incoming = { intentType: "review", category: "new-cat" };
    expect(mergePreservedExtras(current, incoming)).toEqual({
      intentType: "review",
      category: "new-cat",
      featured: true,
    });
  });

  it("preserves featured=true even when incoming sets it to false", () => {
    // Spec rationale: human editor's curation wins over LLM re-generation.
    const current = { featured: true };
    const incoming = { featured: false, intentType: "review" };
    expect(mergePreservedExtras(current, incoming)).toEqual({
      featured: true,
      intentType: "review",
    });
  });

  it("preserves pricingVerifiedAt timestamp from current", () => {
    const current = { pricingVerifiedAt: "2026-05-01" };
    const incoming = { intentType: "pricing" };
    const result = mergePreservedExtras(current, incoming);
    expect(result?.pricingVerifiedAt).toBe("2026-05-01");
    expect(result?.intentType).toBe("pricing");
  });

  it("lets current=null fall through so incoming can introduce a fresh value", () => {
    // Editor removed `featured: true` from MDX → Astro-Import wrote null.
    // Tool re-generate may set featured anew via the LLM if it sees signals.
    const current = { featured: null };
    const incoming = { featured: true };
    expect(mergePreservedExtras(current, incoming)).toEqual({ featured: true });
  });

  it("does not preserve keys outside the whitelist", () => {
    const current = { category: "preserved?", randomEditorialNote: "stays?" };
    const incoming = { category: "overwritten" };
    const result = mergePreservedExtras(current, incoming);
    expect(result?.category).toBe("overwritten");
    expect(result).not.toHaveProperty("randomEditorialNote");
  });

  it("treats missing keys in current as no-op (does NOT inject undefined)", () => {
    const current = { unrelated: "x" };
    const incoming = { intentType: "review" };
    const result = mergePreservedExtras(current, incoming);
    expect(result).toEqual({ intentType: "review" });
    expect(Object.hasOwn(result ?? {}, "featured")).toBe(false);
  });
});
