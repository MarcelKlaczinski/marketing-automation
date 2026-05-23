/**
 * Spec multi-domain-evolution S2.5 — baseFrontmatter() Core factory.
 * Acceptance criterion from §3.2: the Toolwiki-Blog-Schema must compose
 * as `baseFrontmatter(['de','en']).merge(ToolwikiBlogExtras)` with zero
 * type errors. This file also covers the seoCore / i18nCore / clusterCore
 * / monetizationCore modules.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  baseFrontmatter,
  clusterCore,
  i18nCore,
  imagePath,
  isoDate,
  makeLocaleEnum,
  monetizationCore,
  seoCore,
} from "../src/core/index.ts";
import { BlogExtrasSchema } from "../src/domains/toolwiki/extras-blog.ts";

describe("isoDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isoDate.safeParse("2026-05-23").success).toBe(true);
  });

  it("rejects DD.MM.YYYY", () => {
    expect(isoDate.safeParse("23.05.2026").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isoDate.safeParse("").success).toBe(false);
  });
});

describe("imagePath", () => {
  it("accepts a root-relative path", () => {
    expect(imagePath.safeParse("/gen/test/hero.webp").success).toBe(true);
  });

  it("accepts an https URL", () => {
    expect(imagePath.safeParse("https://cdn.toolwiki.ai/hero.webp").success).toBe(true);
  });

  it("rejects a relative path without leading slash", () => {
    expect(imagePath.safeParse("gen/test/hero.webp").success).toBe(false);
  });
});

describe("seoCore", () => {
  it("accepts an empty SEO block (everything optional/defaulted)", () => {
    const r = seoCore.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.noindex).toBe(false);
      expect(r.data.speakable).toBe(false);
    }
  });

  it("rejects seoTitle longer than 70 chars", () => {
    const r = seoCore.safeParse({ seoTitle: "x".repeat(71) });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL canonical", () => {
    const r = seoCore.safeParse({ canonical: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("accepts up to 15 FAQ items", () => {
    const faq = Array.from({ length: 15 }, (_, i) => ({
      question: `q${i}?`,
      answer: "Detailed enough answer.",
    }));
    expect(seoCore.safeParse({ faq }).success).toBe(true);
  });

  it("rejects a 16th FAQ item", () => {
    const faq = Array.from({ length: 16 }, (_, i) => ({
      question: `q${i}?`,
      answer: "Detailed enough answer.",
    }));
    expect(seoCore.safeParse({ faq }).success).toBe(false);
  });
});

describe("i18nCore + makeLocaleEnum", () => {
  it("derives a locale enum from the supplied tuple", () => {
    const e = makeLocaleEnum(["de", "en", "fr"] as const);
    expect(e.safeParse("de").success).toBe(true);
    expect(e.safeParse("en").success).toBe(true);
    expect(e.safeParse("fr").success).toBe(true);
    expect(e.safeParse("es").success).toBe(false);
  });

  it("defaults locale to the first entry in the tuple", () => {
    const schema = i18nCore(["de", "en"] as const);
    const r = schema.parse({});
    expect(r.locale).toBe("de");
  });

  it("accepts an explicit locale", () => {
    const schema = i18nCore(["de", "en"] as const);
    expect(schema.safeParse({ locale: "en" }).success).toBe(true);
  });
});

describe("clusterCore", () => {
  it("accepts the canonical hub-spoke shape", () => {
    const r = clusterCore.safeParse({
      clusterKey: "ai-tools",
      clusterRole: "hub",
      parentSlug: "tech",
      clusterOrder: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a negative clusterOrder", () => {
    const r = clusterCore.safeParse({ clusterOrder: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown clusterRole", () => {
    const r = clusterCore.safeParse({ clusterRole: "leaf" });
    expect(r.success).toBe(false);
  });

  it("accepts an entirely empty cluster block (everything optional)", () => {
    expect(clusterCore.safeParse({}).success).toBe(true);
  });
});

describe("monetizationCore (factory)", () => {
  it("applies the per-domain defaults when fields are absent", () => {
    const schema = monetizationCore(["top", "mid"], true);
    const r = schema.parse({});
    expect(r.adsenseSlots).toEqual(["top", "mid"]);
    expect(r.hasAffiliateLinks).toBe(true);
  });

  it("accepts adsenseSlots: false (Bucket A explicit opt-out)", () => {
    const schema = monetizationCore(["top"], false);
    const r = schema.parse({ adsenseSlots: false });
    expect(r.adsenseSlots).toBe(false);
  });

  it("rejects an unknown slot name", () => {
    const schema = monetizationCore(false, false);
    expect(schema.safeParse({ adsenseSlots: ["sidebar"] }).success).toBe(false);
  });
});

describe("baseFrontmatter() composition", () => {
  it("compiles for a DE-only domain", () => {
    const schema = baseFrontmatter(["de"] as const);
    const r = schema.safeParse({ title: "Mein Artikel" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("Mein Artikel");
      expect(r.data.locale).toBe("de");
      expect(r.data.draft).toBe(false);
      expect(r.data.featured).toBe(false);
      expect(r.data.tags).toEqual([]);
    }
  });

  it("compiles for a bilingual DE/EN domain (Toolwiki)", () => {
    const schema = baseFrontmatter(["de", "en"] as const);
    const r = schema.safeParse({
      title: "AI Tools Compared",
      publishedAt: "2026-05-23",
      updatedAt: "2026-05-23",
      locale: "en",
      translationKey: "ai-tools-compared",
      seoTitle: "Top AI Tools 2026",
      seoDescription: "Compare ChatGPT, Claude, Midjourney by features and price.",
      clusterKey: "ai-tools",
      clusterRole: "hub",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.locale).toBe("en");
      expect(r.data.clusterRole).toBe("hub");
    }
  });

  it("accepts the canonical publishedAt + updatedAt pair (resolves Phase-1 E13)", () => {
    const schema = baseFrontmatter(["de"] as const);
    const r = schema.parse({
      title: "Test",
      publishedAt: "2026-01-01",
      updatedAt: "2026-05-23",
    });
    expect(r.publishedAt).toBe("2026-01-01");
    expect(r.updatedAt).toBe("2026-05-23");
  });

  it("rejects a publishedAt in DE format", () => {
    const schema = baseFrontmatter(["de"] as const);
    const r = schema.safeParse({ title: "Test", publishedAt: "01.01.2026" });
    expect(r.success).toBe(false);
  });

  it("Toolwiki acceptance: baseFrontmatter(['de','en']).merge(BlogExtras) composes", () => {
    // Spec multi-domain-evolution S2.5 acceptance criterion §3.2.
    const ToolwikiBlogSchema = baseFrontmatter(["de", "en"] as const).merge(BlogExtrasSchema);
    const r = ToolwikiBlogSchema.safeParse({
      title: "Wie Claude funktioniert",
      locale: "de",
      intentType: "tutorial",
      bottomLinksVariant: "tool",
      primaryTool: "claude",
      showTopicLinks: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Type-level: BlogExtras fields land on the merged type
      expect(r.data.intentType).toBe("tutorial");
      expect(r.data.primaryTool).toBe("claude");
      // Base fields still defaulted
      expect(r.data.locale).toBe("de");
      expect(r.data.noindex).toBe(false);
      expect(r.data.draft).toBe(false);
    }
  });

  it("composed Toolwiki-Blog schema rejects an unknown intentType after merge", () => {
    const ToolwikiBlogSchema = baseFrontmatter(["de", "en"] as const).merge(BlogExtrasSchema);
    const r = ToolwikiBlogSchema.safeParse({
      title: "Sample",
      intentType: "wirtschaftlichkeit", // not in the Toolwiki blog intent set
    });
    expect(r.success).toBe(false);
  });
});

describe("BaseFrontmatter<T> type alias", () => {
  it("is inferable for a real domain locale set", () => {
    // Compile-time check only — if this assertion compiles, the type alias
    // works. Spec §3.2 says the consumer pattern is:
    //   `baseFrontmatter(['de','en']).merge(ToolwikiBlogExtras)` ✓
    const schema = baseFrontmatter(["de", "en"] as const);
    type FM = z.infer<typeof schema>;
    const sample: FM = schema.parse({ title: "Sample" });
    expect(sample.title).toBe("Sample");
  });
});
