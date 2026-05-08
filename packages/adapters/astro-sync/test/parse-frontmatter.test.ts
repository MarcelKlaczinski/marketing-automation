import { describe, expect, test } from "bun:test";
import { parseMdxContent } from "../src/import/parse-frontmatter.ts";

describe("parseMdxContent", () => {
  test("extracts typed frontmatter fields", () => {
    const raw = `---
title: "Test Article"
slug: "test-article"
locale: "de"
translationKey: "test-key"
publishedAt: 2026-04-12
category: "marketing-seo"
tags: ["test", "ai"]
---

# Heading 1

Some body content with [a link](/de/blog/test/).
<AffiliateLink slug="anyword">Anyword</AffiliateLink>
`;
    const result = parseMdxContent("blog/de/test-article.mdx", raw);

    expect(result.typed.title).toBe("Test Article");
    expect(result.typed.slug).toBe("test-article");
    expect(result.typed.locale).toBe("de");
    expect(result.typed.translationKey).toBe("test-key");
    expect(result.typed.tags).toEqual(["test", "ai"]);
    expect(result.metadata.hasAffiliateLinks).toBe(true);
    expect(result.metadata.headings).toEqual([{ level: 1, text: "Heading 1" }]);
    expect(result.metadata.internalLinks).toContain("/de/blog/test/");
  });

  test("falls back to filename for slug", () => {
    const raw = `---
title: "No Slug"
---
Body`;
    const result = parseMdxContent("blog/de/my-article.mdx", raw);
    expect(result.typed.slug).toBe("my-article");
  });

  test("falls back to path for locale", () => {
    const raw = `---
title: "No Locale"
---
Body`;
    const result = parseMdxContent("blog/en/my-article.mdx", raw);
    expect(result.typed.locale).toBe("en");
  });

  test("separates typed fields from extras", () => {
    const raw = `---
title: "Tool Article"
slug: "anyword-tool"
toolSlug: "anyword"
pricing: "freemium"
rating: 4.5
---
Body`;
    const result = parseMdxContent("tools/de/anyword-tool.mdx", raw);
    expect(result.typed.title).toBe("Tool Article");
    expect(result.extras.toolSlug).toBe("anyword");
    expect(result.extras.pricing).toBe("freemium");
    expect(result.extras.rating).toBe(4.5);
    expect(result.extras.title).toBeUndefined();
  });

  test("computes word count and reading time", () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const raw = `---
title: "Long Article"
---
${words}`;
    const result = parseMdxContent("blog/de/long.mdx", raw);
    expect(result.metadata.wordCount).toBeGreaterThan(350);
    expect(result.metadata.readingTimeMinutes).toBe(2);
  });

  test("detects /go/ affiliate links", () => {
    const raw = `---
title: "Affiliate"
---
Check out [this tool](/go/anyword/) for AI writing.`;
    const result = parseMdxContent("blog/de/affiliate.mdx", raw);
    expect(result.metadata.hasAffiliateLinks).toBe(true);
  });

  test("counts images", () => {
    const raw = `---
title: "Images"
---
![hero](hero.jpg)
<Image src="banner.png" alt="banner" />
Normal text.`;
    const result = parseMdxContent("blog/de/images.mdx", raw);
    expect(result.metadata.imageCount).toBe(2);
  });

  test("noindex defaults to false when absent", () => {
    const raw = `---
title: "Normal"
---
Body`;
    const result = parseMdxContent("blog/de/normal.mdx", raw);
    expect(result.typed.noindex).toBe(false);
  });

  test("parses noindex: true", () => {
    const raw = `---
title: "Hidden"
noindex: true
---
Body`;
    const result = parseMdxContent("blog/de/hidden.mdx", raw);
    expect(result.typed.noindex).toBe(true);
  });
});
