import { describe, expect, it } from "bun:test";
import {
  buildTranslationPersistInput,
  type BuildPersistInputArgs,
} from "../../../src/article/translation/pipeline.ts";
import type { TranslationSetupOutput } from "../../../src/article/translation/setup-step.ts";

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeSetup(overrides: Partial<TranslationSetupOutput> = {}): TranslationSetupOutput {
  return {
    targetArticleId:        "11111111-1111-1111-1111-111111111111",
    sourceBodyMd:           "# ChatGPT bekommt Werbung\n\nOpenAI führt Werbung ein.",
    sourceTitle:            "ChatGPT bekommt Werbung",
    sourceMetaDescription:  "OpenAI führt Werbung in ChatGPT ein.",
    sourceBodyExcerpt:      "ChatGPT bekommt Werbung",
    primaryKeyword:         "chatgpt werbung",
    intentType:             "general",
    briefSource:            "trend_discovery",
    voiceReferences:        [],
    projectSlug:            "toolwiki",
    cornerstoneKeyword:     "chatgpt werbung",
    translationKey:         "trans-key-1",
    sourceLocale:           "de",
    targetLocale:           "en",
    sourceHeroR2Key:        "toolwiki/articles/hero/abc123.webp",
    sourceHeroPublicUrl:    "https://cdn.toolwiki.ai/articles/hero/abc123.webp",
    sourceHeroAltText:      "ChatGPT bekommt Werbung – Beitragsbild",
    sourceSchemaJsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "ChatGPT bekommt Werbung",
        description: "OpenAI führt Werbung in ChatGPT ein.",
        image: "https://cdn.toolwiki.ai/articles/hero/abc123.webp",
        datePublished: "2026-05-22T10:00:00.000Z",
        dateModified: "2026-05-22T10:00:00.000Z",
        author: { "@type": "Person", name: "Anna Weidner" },
        publisher: { "@type": "Organization", name: "Toolwiki" },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": "https://toolwiki.ai/de/blog/chatgpt-werbung-2026",
        },
      },
    ],
    sourceCategory:    "KI-News",
    sourceSubcategory: null,
    sourceFrontmatterExtras: null,
    projectDomain:     "toolwiki.ai",
    sourceCollection:  "blog",
    ...overrides,
  };
}

function makeArgs(overrides: {
  setup?: Partial<TranslationSetupOutput>;
  body?: Partial<BuildPersistInputArgs["body"]>;
  linked?: Partial<BuildPersistInputArgs["linked"]>;
  selfReview?: Partial<BuildPersistInputArgs["selfReview"]>;
} = {}): BuildPersistInputArgs {
  return {
    setup: makeSetup(overrides.setup),
    body: {
      bodyMd:                "# ChatGPT Ads Coming\n\nOpenAI is rolling out ads.",
      wordCount:             10,
      targetTitle:           "ChatGPT Ads Coming",
      targetMetaDescription: "OpenAI is rolling out ChatGPT ads to free-tier users.",
      targetTags:            [],
      ...overrides.body,
    },
    linked: {
      bodyMd:      "# ChatGPT Ads Coming\n\n[OpenAI](/en/tools/openai) is rolling out ads.",
      linksAdded:  1,
      linkedTools: ["openai"],
      ...overrides.linked,
    },
    selfReview: {
      score:       0.85,
      issues:      [],
      shouldBlock: false,
      summary:     "OK",
      ...overrides.selfReview,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TranslationPipeline bridge — locale-aware fields (Spec 64.3)", () => {
  it("Bug #3a — regenerates heroAltText with target-locale suffix", () => {
    const result = buildTranslationPersistInput(makeArgs());

    expect(result.heroAltText).toBe("ChatGPT Ads Coming — Hero Image");
    expect(result.heroAltText).not.toMatch(/Beitragsbild/);
  });

  it("Bug #3a — produces German suffix when targetLocale=de", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        setup: { sourceLocale: "en", targetLocale: "de" },
        body: { targetTitle: "ChatGPT bekommt Werbung" },
      }),
    );

    expect(result.heroAltText).toBe("ChatGPT bekommt Werbung – Beitragsbild");
  });

  it("Bug #3b — schema.description uses targetMetaDescription, not source DE", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;

    expect(schema.description).toBe("OpenAI is rolling out ChatGPT ads to free-tier users.");
    expect(schema.description).not.toMatch(/führt|Werbung/);
  });

  it("Bug #3c — schema.mainEntityOfPage.@id is target-locale canonical URL", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;
    const mep = schema.mainEntityOfPage as { "@type": string; "@id": string };

    expect(mep["@type"]).toBe("WebPage");
    expect(mep["@id"]).toBe("https://toolwiki.ai/en/blog/chatgpt-ads-coming");
    expect(mep["@id"]).not.toContain("/de/");
  });

  it("preserves language-neutral schema fields (author, publisher, dates, image)", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;

    const author = schema.author as { "@type": string; name: string };
    const publisher = schema.publisher as { "@type": string; name: string };
    expect(author.name).toBe("Anna Weidner");
    expect(publisher.name).toBe("Toolwiki");
    expect(schema.datePublished).toBe("2026-05-22T10:00:00.000Z");
    expect(schema.dateModified).toBe("2026-05-22T10:00:00.000Z");
    expect(schema.image).toBe("https://cdn.toolwiki.ai/articles/hero/abc123.webp");
    expect(schema["@type"]).toBe("Article");
    expect(schema["@context"]).toBe("https://schema.org");
  });

  it("Spec 64.3 — inLanguage switches to target BCP-47 tag (DE→EN)", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;
    expect(schema.inLanguage).toBe("en-US");
  });

  it("Spec 64.3 — inLanguage switches to target BCP-47 tag (EN→DE)", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        setup: { sourceLocale: "en", targetLocale: "de" },
        body: { targetTitle: "ChatGPT bekommt Werbung" },
      }),
    );
    const schema = result.schemaJsonLd as Record<string, unknown>;
    expect(schema.inLanguage).toBe("de-DE");
  });

  it("headline switched to targetTitle", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;

    expect(schema.headline).toBe("ChatGPT Ads Coming");
  });

  it("preserves LANG_INDEPENDENT_EXTRAS unchanged (R2 hero key, etc.)", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        setup: {
          sourceFrontmatterExtras: {
            intentType:       "review",
            primaryTool:      "openai",
            pricingTier:      "freemium",
            features:         ["chat", "tools"],
            pros:             ["fast", "accurate"],
            cons:             ["expensive"],
            // Language-specific — must NOT be propagated:
            excerpt:          "Eine deutsche Excerpt-Zeile",
            seoTitle:         "Deutscher SEO-Titel",
            category:         "Praxis & Use Cases",
          } as Record<string, unknown>,
        },
      }),
    );

    expect(result.domainExtras).toBeDefined();
    const fx = result.domainExtras as Record<string, unknown>;
    // LANG_INDEPENDENT preserved
    expect(fx.intentType).toBe("review");
    expect(fx.primaryTool).toBe("openai");
    expect(fx.pricingTier).toBe("freemium");
    expect(fx.features).toEqual(["chat", "tools"]);
    expect(fx.pros).toEqual(["fast", "accurate"]);
    expect(fx.cons).toEqual(["expensive"]);
    // Language-specific dropped — excerpt is replaced with targetMetaDescription
    expect(fx.excerpt).toBe("OpenAI is rolling out ChatGPT ads to free-tier users.");
    expect(fx.seoTitle).toBeUndefined();
    expect(fx.category).toBeUndefined();
  });

  it("collection-aware canonical URL for non-blog collections (ki-wissen)", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        setup: { sourceCollection: "ki-wissen" },
        body: { targetTitle: "What is RAG" },
      }),
    );
    const schema = result.schemaJsonLd as Record<string, unknown>;
    const mep = schema.mainEntityOfPage as { "@id": string };

    expect(mep["@id"]).toBe("https://toolwiki.ai/en/ki-wissen/what-is-rag");
  });

  it("collection-aware canonical URL for non-blog collections (comparisons)", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        setup: { sourceCollection: "comparisons" },
        body: { targetTitle: "Claude vs GPT" },
      }),
    );
    const schema = result.schemaJsonLd as Record<string, unknown>;
    const mep = schema.mainEntityOfPage as { "@id": string };

    expect(mep["@id"]).toBe("https://toolwiki.ai/en/comparisons/claude-vs-gpt");
  });

  it("falls back to source title in heroAltText when LLM omits targetTitle", () => {
    const result = buildTranslationPersistInput(
      makeArgs({
        body: { targetTitle: "" },
      }),
    );

    // Falls back to source title for alt-text, but still uses target-locale suffix
    expect(result.heroAltText).toBe("ChatGPT bekommt Werbung — Hero Image");
  });
});
