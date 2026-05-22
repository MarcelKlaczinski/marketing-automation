import { describe, expect, it } from "bun:test";
import { buildCanonicalUrl } from "../../../src/article/lib/canonical-url.ts";

describe("buildCanonicalUrl (Spec 64.3)", () => {
  it("produces blog URL for de locale", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "de",
        collection: "blog",
        slug: "chatgpt-werbung-2026",
      }),
    ).toBe("https://toolwiki.ai/de/blog/chatgpt-werbung-2026");
  });

  it("maps narrow `comparison` enum to Astro folder `comparisons`", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "de",
        collection: "comparison",
        slug: "claude-vs-gpt",
      }),
    ).toBe("https://toolwiki.ai/de/comparisons/claude-vs-gpt");
  });

  it("accepts the wider Astro folder value directly", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "en",
        collection: "comparisons",
        slug: "claude-vs-gpt",
      }),
    ).toBe("https://toolwiki.ai/en/comparisons/claude-vs-gpt");
  });

  it("preserves ki-wissen / tools / usecases path segments", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "de",
        collection: "ki-wissen",
        slug: "rag-erklaert",
      }),
    ).toBe("https://toolwiki.ai/de/ki-wissen/rag-erklaert");

    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "en",
        collection: "tools",
        slug: "chatgpt",
      }),
    ).toBe("https://toolwiki.ai/en/tools/chatgpt");

    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "de",
        collection: "usecases",
        slug: "kundenservice",
      }),
    ).toBe("https://toolwiki.ai/de/usecases/kundenservice");
  });

  it("falls through unknown collection values as URL segment", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "de",
        collection: "future-collection",
        slug: "test",
      }),
    ).toBe("https://toolwiki.ai/de/future-collection/test");
  });

  it("works with EN locale and blog default", () => {
    expect(
      buildCanonicalUrl({
        projectDomain: "toolwiki.ai",
        locale: "en",
        collection: "blog",
        slug: "chatgpt-ads-2026",
      }),
    ).toBe("https://toolwiki.ai/en/blog/chatgpt-ads-2026");
  });
});
