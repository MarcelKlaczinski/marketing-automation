/**
 * Spec 65.7-followup-2 — `buildFamilyAMultiSlideRenderInput` integration tests.
 *
 * Covers the helper's offline behaviour via DI stubs:
 *   - non-multi-slide templateKey throws (programmer-error guard)
 *   - happy path per template (grid-3 / grid-5 / h2h-vs / h2h-deep-dive): returns
 *     `kind: "family-a-multi-slide"` snapshot with the correct `slideTotal` and
 *     a `compositionInput` that includes `slideTotal` + tools + verdict + end
 *   - LLM-fallback: when `generateContent` returns WITHOUT the `_<key>Extra`
 *     field, the per-template `buildFallbackExtra(ctx, locale)` fires inside
 *     the snapshot builder — composition still has `slideTotal` set
 *   - caption + hashtags from `generateContent` propagate untouched
 */
import { describe, expect, it } from "bun:test";
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import type {
  FamilyATool,
  GeneratedContent,
  Grid3Context,
  Grid5Context,
  HeadToHeadDeepDiveContext,
  HeadToHeadVsContext,
  TemplateDefinition,
} from "@marketing-auto/social/templates";
import {
  FAMILY_A_MULTI_SLIDE_TEMPLATE_KEYS,
  buildFamilyAMultiSlideRenderInput,
} from "../../../src/article/social-image/family-a-multi-slide-render.ts";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function mkArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "00000000-0000-0000-0000-000000000aaa",
    projectId: "00000000-0000-0000-0000-000000000bbb",
    title: "Top 5 AI Video Tools",
    slug: "top-5-ai-video-tools",
    bodyMd: "",
    bodyHtml: null,
    metaDescription: null,
    cornerstoneKeyword: null,
    intentType: null,
    primaryTool: null,
    source: "generated",
    status: "proposed",
    locale: "en",
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
    ...overrides,
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
  } as unknown as ArticleDiscovery;
}

function mkTool(slug: string, name: string, isWinner = false): FamilyATool {
  return {
    slug,
    name,
    score: 80,
    scoreTier: "hi" as const,
    meta: "AI video tool",
    pricePrefix: "",
    priceAmount: "—",
    pros: ["Pro one", "Pro two"] as [string, string],
    cons: ["Con one", "Con two"] as [string, string],
    isWinner,
  };
}

/**
 * Stub TemplateDefinition factory — bypasses the registry. `buildInput`
 * returns the per-template Context shape; `generateContent` returns canned
 * caption + hashtags + (optional) `_<key>Extra` payload.
 */
function mkStubTemplate(opts: {
  key: (typeof FAMILY_A_MULTI_SLIDE_TEMPLATE_KEYS)[number];
  toolCount: number;
  narrativeExtraKey:
    | "_grid3Extra"
    | "_grid5Extra"
    | "_headToHeadVsExtra"
    | "_headToHeadDeepDiveExtra";
  omitExtra?: boolean;
}): TemplateDefinition {
  const tools: FamilyATool[] = Array.from({ length: opts.toolCount }, (_, i) =>
    mkTool(`tool-${i + 1}`, `Tool ${i + 1}`, i === 0),
  );
  const firstSlug = tools[0]?.slug;
  const ctx:
    | Grid3Context
    | Grid5Context
    | HeadToHeadVsContext
    | HeadToHeadDeepDiveContext = {
    tools,
    category: "AI Tools",
    ...(firstSlug !== undefined && { winner: firstSlug }),
  };

  const extras = {
    cover: {
      headlineLead: "The top",
      headlineEm: "AI Tools",
      subline: "Five tools, one verdict — which one wins?",
    },
    compareHeader: {
      title: "What we compare",
      criteria: ["Quality", "Price", "Workflow fit"],
    },
    verdict: {
      winnerSlug: tools[0]?.slug ?? "",
      reasoning: "Tool 1 wins because it balances output quality and pricing.",
    },
    end: {
      headlineLead: "More reviews",
      headlineEm: "honestly tested.",
    },
  };

  return {
    key: opts.key,
    displayName: "stub",
    description: "stub",
    defaultSlideCount: 9,
    estimatedCostUsd: 0,
    outputFormat: "carousel",
    compatibleChannels: ["instagram"],
    generationClass: "frontmatter-derived",
    renderServerFn: "renderComparisonGrid5",
    plannerMeta: {
      contentType: "comparison",
      estimatedEngagementTier: "high",
      recycleableFromExistingArticle: true,
      requiresLiveData: false,
    },
    bounds: {},
    generatedSchema: undefined,
    slotMap: {},
    eligibility: () => ({ eligible: true }),
    buildInput: async () => ctx,
    generateContent: async () => {
      const result = {
        hookOutput: {
          pattern: "negative_frame" as const,
          leadPhrase: "Five tools",
          highlightWord: "compared",
          trailPhrase: ".",
          fullText: "Five tools compared.",
          promiseBlock: { line1: "", line2: "" },
        },
        caption: "Stub caption.",
        hashtags: ["#AITools", "#Test", "#Stub"],
        ...(opts.omitExtra ? {} : { [opts.narrativeExtraKey]: extras }),
      } as unknown as GeneratedContent;
      return result;
    },
    render: async () => ({
      slides: [],
      caption: "",
      hashtags: [],
      metadata: { estimatedCostUsd: 0, templateKey: opts.key },
    }),
    mockFixtures: {},
  } as unknown as TemplateDefinition;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildFamilyAMultiSlideRenderInput", () => {
  it("rejects non-multi-slide templateKey with a programmer-error message", async () => {
    await expect(
      buildFamilyAMultiSlideRenderInput(
        {
          templateKey: "comparison-grid-4",
          article: mkArticle(),
          discovery: mkDiscovery(),
          locale: "en",
          theme: "dark",
        },
        {
          loadTemplate: () =>
            mkStubTemplate({
              key: "comparison-grid-5",
              toolCount: 5,
              narrativeExtraKey: "_grid5Extra",
            }),
        },
      ),
    ).rejects.toThrow(/non-Family-A-multi-slide/);
  });

  it("comparison-grid-5: produces kind:family-a-multi-slide snapshot with slideTotal=9", async () => {
    const result = await buildFamilyAMultiSlideRenderInput(
      {
        templateKey: "comparison-grid-5",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "en",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({
            key: "comparison-grid-5",
            toolCount: 5,
            narrativeExtraKey: "_grid5Extra",
          }),
        llmCaller: async () => "ignored — generateContent stub bypasses the caller",
      },
    );

    expect(result.renderInput.kind).toBe("family-a-multi-slide");
    expect(result.renderInput.templateKey).toBe("comparison-grid-5");
    expect(result.renderInput.slideTotal).toBe(9);
    expect(result.slideTotal).toBe(9);
    expect(result.caption).toBe("Stub caption.");
    expect(result.hashtags).toEqual(["#AITools", "#Test", "#Stub"]);

    // compositionInput MUST carry slideTotal — this is the bug the spec fixes.
    const ci = result.renderInput.compositionInput;
    expect(ci.slideTotal).toBe(9);
    expect(ci.slideIndex).toBe(0);
    expect(ci.theme).toBe("dark");
    expect(ci.locale).toBe("en");
    expect(Array.isArray(ci.tools)).toBe(true);
    expect((ci.tools as unknown[]).length).toBe(5);
  });

  it("comparison-grid-3: produces snapshot with slideTotal=7", async () => {
    const result = await buildFamilyAMultiSlideRenderInput(
      {
        templateKey: "comparison-grid-3",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "de",
        theme: "light",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({
            key: "comparison-grid-3",
            toolCount: 3,
            narrativeExtraKey: "_grid3Extra",
          }),
      },
    );

    expect(result.renderInput.slideTotal).toBe(7);
    expect(result.renderInput.compositionInput.slideTotal).toBe(7);
    expect((result.renderInput.compositionInput.tools as unknown[]).length).toBe(3);
  });

  it("head-to-head-vs: produces snapshot with slideTotal=6 and exactly 2 tools", async () => {
    const result = await buildFamilyAMultiSlideRenderInput(
      {
        templateKey: "head-to-head-vs",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "en",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({
            key: "head-to-head-vs",
            toolCount: 2,
            narrativeExtraKey: "_headToHeadVsExtra",
          }),
      },
    );

    expect(result.renderInput.slideTotal).toBe(6);
    expect(result.renderInput.compositionInput.slideTotal).toBe(6);
  });

  it("head-to-head-deep-dive: produces snapshot with slideTotal=9", async () => {
    const result = await buildFamilyAMultiSlideRenderInput(
      {
        templateKey: "head-to-head-deep-dive",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "en",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({
            key: "head-to-head-deep-dive",
            toolCount: 2,
            narrativeExtraKey: "_headToHeadDeepDiveExtra",
          }),
      },
    );

    expect(result.renderInput.slideTotal).toBe(9);
    expect(result.renderInput.compositionInput.slideTotal).toBe(9);
  });

  it("falls back to buildFallbackExtra when generateContent omits the _<key>Extra field", async () => {
    const result = await buildFamilyAMultiSlideRenderInput(
      {
        templateKey: "comparison-grid-5",
        article: mkArticle(),
        discovery: mkDiscovery(),
        locale: "en",
        theme: "dark",
      },
      {
        loadTemplate: () =>
          mkStubTemplate({
            key: "comparison-grid-5",
            toolCount: 5,
            narrativeExtraKey: "_grid5Extra",
            omitExtra: true,
          }),
      },
    );

    // slideTotal must still be set even on the fallback path.
    expect(result.renderInput.slideTotal).toBe(9);
    expect(result.renderInput.compositionInput.slideTotal).toBe(9);
    // verdict / cover should still be populated by buildFallbackExtra.
    expect(result.renderInput.compositionInput.verdict).toBeDefined();
    expect(result.renderInput.compositionInput.cover).toBeDefined();
  });
});
