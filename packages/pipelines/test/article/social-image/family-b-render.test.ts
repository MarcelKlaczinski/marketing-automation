/**
 * Spec 65.8 Day-5-followup — `buildFamilyBRenderInput` integration tests.
 *
 * Covers the helper's offline behaviour via DI stubs:
 *   - non-Family-B templateKey throws (programmer-error guard)
 *   - happy path: returns a discriminated `kind: "family-b"` snapshot with
 *     templateKey + compositionInput keyed at slideIndex 0
 *   - per-template tool-field mapping (`primaryTool` for story-arc,
 *     `featuredTool` for lifestyle-listicle, `recommendedTool` for opinion-
 *     recommendation)
 *   - stagedImages are normalised + dropped when slideIndex falls outside
 *     the template's slideTotal
 *   - endSlideData is propagated when present
 *   - LLM-fallback path: when `generateContent` returns a result WITHOUT the
 *     expected `_<key>Extra` field, narrative falls back to an empty-but-valid
 *     placeholder so the worker still renders gradient-only
 */
import { describe, expect, it } from "bun:test";
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import type {
  GeneratedContent,
  TemplateDefinition,
} from "@marketing-auto/social/templates";
import {
  FAMILY_B_TEMPLATE_KEYS,
  FAMILY_B_TOTAL_SLIDES,
  buildFamilyBRenderInput,
} from "../../../src/article/social-image/family-b-render.ts";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function mkArticle(): Article {
  return {
    id: "00000000-0000-0000-0000-000000000aaa",
    projectId: "00000000-0000-0000-0000-000000000bbb",
    title: "Mein Klick-Story-Test",
    slug: "klick-story",
    bodyMd: "",
    bodyHtml: null,
    metaDescription: null,
    cornerstoneKeyword: null,
    intentType: null,
    primaryTool: null,
    source: "generated",
    status: "proposed",
    locale: "de",
    collection: "recurring_content",
    category: null,
    subcategory: null,
    toolPricing: null,
    toolPriceFrom: null,
    toolRating: null,
    toolVotes: null,
    toolAffiliateSlug: null,
    toolWebsite: null,
    publishedAt: null,
    frontmatterUpdatedAt: null,
    refreshMetadata: null,
    toolDataRefreshMetadata: null,
    lastEditedAt: null,
    lastRefreshedAt: null,
    lastSyncedFromSiblingAt: null,
    schemaJsonLd: null,
    pageSpeedScore: null,
    pageSpeedAuditedAt: null,
    pageSpeedMetadata: null,
    translationKey: null,
    domainExtras: {},
    astroFrontmatter: null,
    importMetadata: null,
    importedFromFilePath: null,
    importedHash: null,
    rawMdxBody: null,
    syncedAt: null,
    syncedAtCommitSha: null,
    syncStatus: null,
    syncFailureCount: 0,
    clusterId: null,
    clusterKey: null,
    contentPillarId: null,
    authorId: null,
    contentRefId: null,
    sourceBriefId: null,
    pipelineSpawnedFromArticleId: null,
    pipelineSpawnedFromContext: null,
    heroImageR2Key: null,
    heroImageOriginalR2Key: null,
    heroImageSourceSha256: null,
    heroImageAltText: null,
    heroImagePrompt: null,
    heroImageGeneratedAt: null,
    templateKey: null,
    templateVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Article;
}

function mkDiscovery(): ArticleDiscovery {
  return {
    id: "00000000-0000-0000-0000-000000000ccc",
    articleId: "00000000-0000-0000-0000-000000000aaa",
    wordCount: null,
    imageCount: null,
    headerCountH2: null,
    headerCountH3: null,
    headerSlugs: null,
    paragraphCount: null,
    linkCountInternal: null,
    linkCountExternal: null,
    codeBlockCount: null,
    tableCount: null,
    listCountUl: null,
    listCountOl: null,
    hasAffiliateLinks: null,
    referencedTools: null,
    containerFormHint: null,
    completenessScore: null,
    estimatedAngles: null,
    contentHooks: {},
    suggestedTemplates: [],
    narrativeArc: null,
    estimatedCarousels: null,
    contentHash: null,
    enrichmentRunAt: null,
    enrichmentMode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Build a stub TemplateDefinition that bypasses the registry. The `buildInput`
 * returns a Family-B Context shape; `generateContent` returns a canned
 * narrative + caption + hashtags. `render` is unused by the helper.
 */
function mkStubTemplate(opts: {
  key: (typeof FAMILY_B_TEMPLATE_KEYS)[number];
  toolFieldName: "primaryTool" | "featuredTool" | "recommendedTool";
  narrativeExtraKey: "_storyArcExtra" | "_lifestyleExtra" | "_opinionExtra";
  narrative?: Record<string, unknown>;
}): TemplateDefinition {
  return {
    key: opts.key,
    displayName: "stub",
    description: "stub",
    defaultSlideCount: FAMILY_B_TOTAL_SLIDES[opts.key],
    estimatedCostUsd: 0,
    outputFormat: "carousel",
    compatibleChannels: ["instagram"],
    generationClass: "llm-live",
    renderServerFn: opts.key === "story-arc-clickbait"
      ? "renderStoryArcClickbait"
      : opts.key === "lifestyle-listicle"
      ? "renderLifestyleListicle"
      : "renderOpinionRecommendation",
    plannerMeta: {
      contentType: "story",
      estimatedEngagementTier: "medium",
      recycleableFromExistingArticle: false,
      requiresLiveData: false,
    },
    eligibility: () => ({ eligible: true }),
    buildInput: async () => ({
      hook: { rendered: "Mein Hook", variables: { profession: "Texter" } },
      articleSlug: "klick-story",
      articleUrl: "toolwiki.ai/klick-story",
      [opts.toolFieldName]: { slug: "claude", name: "Claude" },
    }),
    generateContent: async () => {
      const result: GeneratedContent & Record<string, unknown> = {
        hookOutput: {
          pattern: "identity_frame",
          leadPhrase: "Mein Hook",
          highlightWord: "x",
          trailPhrase: "y",
          fullText: "Mein Hook",
          promiseBlock: { line1: "Mein Hook", line2: "" },
        },
        caption: "Stub caption.",
        hashtags: ["#KITools", "#Test", "#Stub"],
        [opts.narrativeExtraKey]: opts.narrative ?? buildStubNarrative(opts.key),
      };
      return result;
    },
    buildInputForDiscovery: async () => ({}),
    render: async () => ({
      slides: [],
      caption: "",
      hashtags: [],
      metadata: { estimatedCostUsd: 0, templateKey: opts.key },
    }),
    mockFixtures: {},
  } as unknown as TemplateDefinition;
}

function buildStubNarrative(key: (typeof FAMILY_B_TEMPLATE_KEYS)[number]): Record<string, unknown> {
  if (key === "story-arc-clickbait") {
    return {
      setup: { beatName: "setup", text: "Setup text" },
      conflict: { beatName: "conflict", text: "Conflict text" },
      resolution: { beatName: "resolution", text: "Resolution text" },
      payoff: { beatName: "payoff", text: "Payoff text" },
      lesson: { beatName: "lesson", text: "Lesson text" },
    };
  }
  if (key === "lifestyle-listicle") {
    return {
      intro: { beatName: "intro", text: "Intro text" },
      item1: { beatName: "item1", text: "Item 1 text" },
      item2: { beatName: "item2", text: "Item 2 text" },
      item3: { beatName: "item3", text: "Item 3 text" },
    };
  }
  return {
    hotTake: { beatName: "hotTake", text: "Hot take text" },
    reasoning1: { beatName: "reasoning1", text: "Reasoning 1 text" },
    reasoning2: { beatName: "reasoning2", text: "Reasoning 2 text" },
    topPick: { beatName: "topPick", text: "Top pick text" },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildFamilyBRenderInput", () => {
  it("rejects non-Family-B templateKey with a programmer-error message", async () => {
    await expect(
      buildFamilyBRenderInput(
        {
          templateKey: "comparison-grid-4",
          article: mkArticle(),
          discovery: mkDiscovery(),
          locale: "de",
          theme: "dark",
        },
        { loadTemplate: () => mkStubTemplate({ key: "story-arc-clickbait", toolFieldName: "primaryTool", narrativeExtraKey: "_storyArcExtra" }) },
      ),
    ).rejects.toThrow(/non-Family-B/);
  });

  it("returns a discriminated kind:family-b snapshot for story-arc-clickbait", async () => {
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "story-arc-clickbait",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({ key: "story-arc-clickbait", toolFieldName: "primaryTool", narrativeExtraKey: "_storyArcExtra" }),
        llmCaller: async () => "ignored — generateContent stub bypasses the caller",
      },
    );
    expect(result.renderInput.kind).toBe("family-b");
    expect(result.renderInput.templateKey).toBe("story-arc-clickbait");
    expect(result.renderInput.slideTotal).toBe(7);
    expect(result.slideTotal).toBe(7);
    expect(result.caption).toBe("Stub caption.");
    expect(result.hashtags).toEqual(["#KITools", "#Test", "#Stub"]);
    // compositionInput carries the narrative + hook + tool
    const ci = result.renderInput.compositionInput;
    expect(ci.slideIndex).toBe(0);
    expect(ci.slideTotal).toBe(7);
    expect(ci.hook).toEqual({ rendered: "Mein Hook", variables: { profession: "Texter" } });
    expect(ci.primaryTool).toEqual({ slug: "claude", name: "Claude" });
    expect((ci.narrative as { setup: { text: string } }).setup.text).toBe("Setup text");
  });

  it("maps `featuredTool` for lifestyle-listicle", async () => {
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "lifestyle-listicle",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({ key: "lifestyle-listicle", toolFieldName: "featuredTool", narrativeExtraKey: "_lifestyleExtra" }),
      },
    );
    expect(result.renderInput.slideTotal).toBe(6);
    const ci = result.renderInput.compositionInput;
    expect(ci.featuredTool).toEqual({ slug: "claude", name: "Claude" });
    expect(ci.primaryTool).toBeUndefined();
    expect(ci.recommendedTool).toBeUndefined();
  });

  it("maps `recommendedTool` for opinion-recommendation", async () => {
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "opinion-recommendation",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({ key: "opinion-recommendation", toolFieldName: "recommendedTool", narrativeExtraKey: "_opinionExtra" }),
      },
    );
    expect(result.renderInput.slideTotal).toBe(6);
    const ci = result.renderInput.compositionInput;
    expect(ci.recommendedTool).toEqual({ slug: "claude", name: "Claude" });
    expect(ci.primaryTool).toBeUndefined();
    expect(ci.featuredTool).toBeUndefined();
  });

  it("normalises stagedImages and drops out-of-range slideIndex values", async () => {
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "story-arc-clickbait",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
        stagedImages: [
          { slideIndex: 0, cdnUrl: "https://r2/a.webp", photographer: "Jane" },
          { slideIndex: 3, cdnUrl: "https://r2/d.webp", photographer: null },
          { slideIndex: 99, cdnUrl: "https://r2/oob.webp" }, // out-of-range — dropped
        ],
      },
      {
        loadTemplate: () =>
          mkStubTemplate({ key: "story-arc-clickbait", toolFieldName: "primaryTool", narrativeExtraKey: "_storyArcExtra" }),
      },
    );
    const images = result.renderInput.compositionInput.images as Array<{ slideIndex: number; cdnUrl: string }>;
    expect(images).toHaveLength(2);
    expect(images[0]?.slideIndex).toBe(0);
    expect(images[1]?.slideIndex).toBe(3);
  });

  it("propagates endSlideData onto the compositionInput when provided", async () => {
    const endSlideData = { type: "follow-cta", config: { primary: "Follow @x" } };
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "story-arc-clickbait",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
        endSlideData,
      },
      {
        loadTemplate: () =>
          mkStubTemplate({ key: "story-arc-clickbait", toolFieldName: "primaryTool", narrativeExtraKey: "_storyArcExtra" }),
      },
    );
    expect(result.renderInput.compositionInput.endSlideData).toEqual(endSlideData);
  });

  it("falls back to a structurally-valid empty narrative when _<key>Extra is missing", async () => {
    // Stub generateContent to return a shape WITHOUT the _<key>Extra field.
    const stub = mkStubTemplate({
      key: "story-arc-clickbait",
      toolFieldName: "primaryTool",
      narrativeExtraKey: "_storyArcExtra",
    });
    const stubWithMissingExtra: TemplateDefinition = {
      ...stub,
      generateContent: async () => ({
        hookOutput: stub.mockFixtures as never, // unused
        caption: "fallback caption",
        hashtags: ["#a", "#b"],
        // NOTE: no _storyArcExtra here
      }) as unknown as GeneratedContent,
    };
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "story-arc-clickbait",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
      },
      { loadTemplate: () => stubWithMissingExtra },
    );
    const narrative = result.renderInput.compositionInput.narrative as Record<string, { beatName: string; text: string }>;
    // All 5 beats are present (empty/whitespace text but structurally valid)
    expect(Object.keys(narrative).sort()).toEqual(
      ["conflict", "lesson", "payoff", "resolution", "setup"].sort(),
    );
    expect(narrative.setup?.beatName).toBe("setup");
  });

  it("uses tool placeholder when lifestyle-listicle buildInput omits featuredTool", async () => {
    const stub = mkStubTemplate({
      key: "lifestyle-listicle",
      toolFieldName: "featuredTool",
      narrativeExtraKey: "_lifestyleExtra",
    });
    const stubNoTool: TemplateDefinition = {
      ...stub,
      buildInput: async () => ({
        hook: { rendered: "Hook", variables: {} },
        articleSlug: "x",
        articleUrl: "toolwiki.ai/x",
        // intentionally no featuredTool / primaryTool
      }),
    };
    const result = await buildFamilyBRenderInput(
      {
        templateKey: "lifestyle-listicle",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "dark",
      },
      { loadTemplate: () => stubNoTool },
    );
    const featuredTool = result.renderInput.compositionInput.featuredTool as { slug: string; name: string };
    expect(featuredTool.slug).toBe("unknown");
    expect(featuredTool.name).toBe("—");
  });
});
