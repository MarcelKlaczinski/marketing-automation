/**
 * Spec 64.3 regression guard — German stopwords must never appear in
 * EN translation bridge outputs.
 *
 * If any of these assertions fail in the future, somebody has reintroduced
 * the spread+headline pattern or broken the locale-aware helpers.
 */
import { describe, expect, it } from "bun:test";
import {
  buildTranslationPersistInput,
  type BuildPersistInputArgs,
} from "../../../src/article/translation/pipeline.ts";
import type { TranslationSetupOutput } from "../../../src/article/translation/setup-step.ts";

const GERMAN_STOPWORDS = /\b(der|die|das|und|oder|für|von|mit|Beitragsbild|führt|wird|kann|bekommt|deutsche|deutscher)\b/i;

function makeArgs(): BuildPersistInputArgs {
  const setup: TranslationSetupOutput = {
    targetArticleId:        "11111111-1111-1111-1111-111111111111",
    sourceBodyMd:           "# Der deutsche Titel\n\nDas führt zu Werbung.",
    sourceTitle:            "Der deutsche Titel",
    sourceMetaDescription:  "Das deutsche Beitragsbild und der deutsche Inhalt führt zu Werbung.",
    sourceBodyExcerpt:      "Der deutsche Titel",
    primaryKeyword:         "deutsche werbung",
    intentType:             "general",
    briefSource:            "trend_discovery",
    voiceReferences:        [],
    projectSlug:            "toolwiki",
    cornerstoneKeyword:     "deutsche werbung",
    translationKey:         "trans-key-leak",
    sourceLocale:           "de",
    targetLocale:           "en",
    sourceHeroR2Key:        "toolwiki/articles/hero/leak.webp",
    sourceHeroPublicUrl:    "https://cdn.toolwiki.ai/articles/hero/leak.webp",
    sourceHeroAltText:      "Der deutsche Titel – Beitragsbild",
    sourceSchemaJsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "Der deutsche Titel",
        description: "Das deutsche Beitragsbild führt zu mehr Werbung.",
        image: "https://cdn.toolwiki.ai/articles/hero/leak.webp",
        datePublished: "2026-05-22T10:00:00.000Z",
        dateModified: "2026-05-22T10:00:00.000Z",
        author: { "@type": "Person", name: "Anna Weidner" },
        publisher: { "@type": "Organization", name: "Toolwiki" },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": "https://toolwiki.ai/de/blog/der-deutsche-titel",
        },
      },
    ],
    sourceCategory:    "KI-News",
    sourceSubcategory: null,
    sourceFrontmatterExtras: null,
    projectDomain:     "toolwiki.ai",
    sourceCollection:  "blog",
  };

  return {
    setup,
    body: {
      bodyMd:                "# The English Title\n\nThis is English content.",
      wordCount:             6,
      targetTitle:           "The English Title",
      targetMetaDescription: "An English article about advertising in chat tools.",
      targetTags:            [],
    },
    linked: {
      bodyMd:      "# The English Title\n\nThis is English content.",
      linksAdded:  0,
      linkedTools: [],
    },
    selfReview: {
      score:       0.85,
      issues:      [],
      shouldBlock: false,
      summary:     "OK",
    },
  };
}

describe("Translation Bridge — language-leak guard (Spec 64.3)", () => {
  it("EN articles never contain German stopwords in heroAltText", () => {
    const result = buildTranslationPersistInput(makeArgs());
    expect(result.heroAltText).not.toMatch(GERMAN_STOPWORDS);
  });

  it("EN articles never contain German stopwords in schema.description", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;
    expect(schema.description as string).not.toMatch(GERMAN_STOPWORDS);
  });

  it("EN articles canonical URL is /en/ not /de/", () => {
    const result = buildTranslationPersistInput(makeArgs());
    const schema = result.schemaJsonLd as Record<string, unknown>;
    const mep = schema.mainEntityOfPage as { "@id": string };
    expect(mep["@id"]).toContain("/en/");
    expect(mep["@id"]).not.toContain("/de/");
  });
});
