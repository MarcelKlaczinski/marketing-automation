import { describe, expect, it } from "bun:test";
import {
  ARTICLE_COLLECTION_TYPES,
  type ArticleCollectionType,
  isArticleCollectionType,
} from "../src/enums/collection.ts";

describe("ARTICLE_COLLECTION_TYPES (Spec multi-domain-evolution S2.3)", () => {
  it("contains the 5 canonical Toolwiki collection keys", () => {
    expect(ARTICLE_COLLECTION_TYPES).toEqual([
      "blog",
      "comparison",
      "ki-wissen",
      "tools",
      "usecases",
    ]);
  });

  it("is readonly at the type level (as const tuple)", () => {
    // Compile-time check: the array can't be mutated. The runtime check
    // is symbolic — Object.isFrozen returns false on `as const` arrays,
    // but TS rejects index-assignment at compile time.
    const sample: ArticleCollectionType = ARTICLE_COLLECTION_TYPES[0];
    expect(sample).toBe("blog");
  });
});

describe("isArticleCollectionType type-guard", () => {
  it("returns true for every canonical value", () => {
    for (const v of ARTICLE_COLLECTION_TYPES) {
      expect(isArticleCollectionType(v)).toBe(true);
    }
  });

  it("returns false for an unknown value (e.g. an Astro folder rename)", () => {
    expect(isArticleCollectionType("comparisons")).toBe(false);
    expect(isArticleCollectionType("tool-categories")).toBe(false);
    expect(isArticleCollectionType("")).toBe(false);
  });

  it("returns false for non-string input", () => {
    expect(isArticleCollectionType(null)).toBe(false);
    expect(isArticleCollectionType(undefined)).toBe(false);
    expect(isArticleCollectionType(0)).toBe(false);
    expect(isArticleCollectionType(["blog"])).toBe(false);
  });

  it("narrows the type after a true result (compile-time only)", () => {
    const v: unknown = "blog";
    if (isArticleCollectionType(v)) {
      // If this didn't narrow, the next line would error.
      const narrowed: ArticleCollectionType = v;
      expect(narrowed).toBe("blog");
    }
  });
});
