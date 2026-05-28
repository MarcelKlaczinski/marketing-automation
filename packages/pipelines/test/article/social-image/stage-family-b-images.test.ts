/**
 * Spec 65.8 Day 5 — StageFamilyBImagesStep tests.
 *
 * Coverage:
 *  - Pure helpers (parseDomainExtras / parseExistingCache / parseRecurring /
 *    isFamilyBTemplate / passThroughEmpty) — no DB, no orchestrator.
 *  - Fast-path: non-Family-B templates return passThroughEmpty without
 *    touching DB / orchestrator.
 *  - Family-B happy path: DB seed + DI-injected orchestrator returns staged
 *    images; step persists `familyBImages` into `domain_extras` via
 *    `jsonb_set` and forwards them in output.
 *  - Missing hookData warning path (returns empty result, no orchestrator
 *    invocation).
 *  - No-credentials warning path (returns empty result, no orchestrator
 *    invocation).
 *  - Existing-cache reuse: orchestrator receives the cached entries via
 *    `existingCache`.
 *
 * Uses real DB (mirrors `packages/pipelines/test/article/translation/` test
 * conventions); orchestrator + credentials are DI-injected so the LLM /
 * provider calls stay offline.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { randomUUID } from "node:crypto";
import { makeMockCtx } from "../../fixtures/mock-ctx.ts";
import {
  isFamilyBTemplate,
  parseDomainExtras,
  parseExistingCache,
  parseRecurring,
  passThroughEmpty,
  StageFamilyBImagesStep,
  type StageFamilyBImagesDeps,
} from "../../../src/article/social-image/stage-family-b-images.step.ts";

// ─── Pure helper unit tests ───────────────────────────────────────────────────

describe("isFamilyBTemplate", () => {
  it("returns true for all 3 Family-B template keys", () => {
    expect(isFamilyBTemplate("story-arc-clickbait")).toBe(true);
    expect(isFamilyBTemplate("lifestyle-listicle")).toBe(true);
    expect(isFamilyBTemplate("opinion-recommendation")).toBe(true);
  });

  it("returns false for Family-A templates", () => {
    expect(isFamilyBTemplate("comparison-grid-3")).toBe(false);
    expect(isFamilyBTemplate("comparison-grid-4")).toBe(false);
    expect(isFamilyBTemplate("verdict-per-use-case")).toBe(false);
    expect(isFamilyBTemplate("single-tool-spotlight")).toBe(false);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isFamilyBTemplate(null)).toBe(false);
    expect(isFamilyBTemplate(undefined)).toBe(false);
    expect(isFamilyBTemplate("")).toBe(false);
  });
});

describe("parseDomainExtras", () => {
  it("returns the object when given a valid record", () => {
    const obj = { recurring: { formatConfig: {} } };
    expect(parseDomainExtras(obj)).toBe(obj);
  });
  it("returns {} for null / undefined / primitive inputs", () => {
    expect(parseDomainExtras(null)).toEqual({});
    expect(parseDomainExtras(undefined)).toEqual({});
    expect(parseDomainExtras("string")).toEqual({});
    expect(parseDomainExtras(42)).toEqual({});
  });
});

describe("parseExistingCache", () => {
  it("returns the array when familyBImages is well-formed", () => {
    const entries = [
      {
        slideIndex: 0,
        r2Key: "tw/articles/abc/images/x.webp",
        r2Url: "https://cdn.example.com/x.webp",
        originalR2Key: null,
        license: {
          provider: "unsplash" as const,
          photographer: "Jane Doe",
          sourceUrl: "https://unsplash.com/p/x",
        },
        queryUsed: "test",
        cachedAt: "2026-05-26T00:00:00.000Z",
      },
    ];
    expect(parseExistingCache({ familyBImages: entries })).toEqual(entries);
  });

  it("returns [] when familyBImages is missing / malformed", () => {
    expect(parseExistingCache({})).toEqual([]);
    expect(parseExistingCache({ familyBImages: "not an array" })).toEqual([]);
    expect(parseExistingCache({ familyBImages: [{ slideIndex: -1 }] })).toEqual([]);
  });
});

describe("parseRecurring", () => {
  it("returns the recurring object when present", () => {
    const recurring = { formatConfig: { hookData: { rendered: "x" } } };
    const result = parseRecurring({ recurring });
    expect(result).toBe(recurring);
  });

  it("returns null when recurring is absent / malformed", () => {
    expect(parseRecurring({})).toBeNull();
    expect(parseRecurring({ recurring: "string" })).toBeNull();
    expect(parseRecurring({ recurring: null })).toBeNull();
  });
});

describe("passThroughEmpty", () => {
  it("returns input unchanged + empty familyBImages + stats with zeroed counts", () => {
    const input = {
      articleId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      projectSlug: "test",
      templateKeyOverride: null,
    };
    const result = passThroughEmpty(input, null);
    expect(result.familyBImages).toEqual([]);
    expect(result.familyBImagesStats).toEqual({
      templateKey: null,
      cacheHits: 0,
      freshStages: 0,
      failures: 0,
      totalProviderCandidates: 0,
    });
    expect(result.articleId).toBe(input.articleId);
  });
});

// ─── Integration tests (real DB + DI orchestrator) ────────────────────────────

const TEST_PROJECT_ID = randomUUID();
const TEST_PROJECT_SLUG = `stage-family-b-test-${TEST_PROJECT_ID.slice(0, 8)}`;
let testArticleId: string;

beforeAll(async () => {
  await db.insert(projects).values({
    id: TEST_PROJECT_ID,
    slug: TEST_PROJECT_SLUG,
    name: "Stage Family B Test Project",
    industry: "other",
    pipelineTemplate: "educational",
    costLimits: {},
  });
});

beforeEach(async () => {
  testArticleId = randomUUID();
  await db.insert(articles).values({
    id: testArticleId,
    projectId: TEST_PROJECT_ID,
    locale: "de",
    slug: `test-article-${testArticleId.slice(0, 8)}`,
    title: "Test article",
    collection: "recurring_content",
    status: "proposed",
    source: "generated",
    domainExtras: {
      recurring: {
        formatConfig: {
          hookData: {
            rendered: "Wie ich als Texter meinen Job mit KI rettete",
            variables: { profession: "Texter", lifeArea: "Job" },
          },
        },
      },
    },
  });
});

afterEach(async () => {
  await db.delete(articles).where(eq(articles.id, testArticleId));
});

function makeStepWithDeps(orchestratorImpl: StageFamilyBImagesDeps["runOrchestrator"]): StageFamilyBImagesStep {
  return new StageFamilyBImagesStep({
    // All providers null by default — tests that need creds override.
    loadCredentials: async () => ({ pexels: null, unsplash: null, pixabay: null }),
    ...(orchestratorImpl !== undefined && { runOrchestrator: orchestratorImpl }),
  });
}

describe("StageFamilyBImagesStep.execute — non-Family-B fast path", () => {
  it("returns empty familyBImages without invoking the orchestrator", async () => {
    let orchestratorCalled = false;
    const step = makeStepWithDeps(async () => {
      orchestratorCalled = true;
      return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshStages: 0, failures: 0, totalProviderCandidates: 0 } };
    });
    const result = await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "comparison-grid-3",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect(orchestratorCalled).toBe(false);
    expect(result.familyBImages).toEqual([]);
    expect(result.familyBImagesStats?.templateKey).toBe("comparison-grid-3");
  });
});

describe("StageFamilyBImagesStep.execute — Family-B paths", () => {
  it("skips orchestration when hookData is missing in article.domain_extras", async () => {
    // Wipe the seeded recurring.formatConfig.hookData
    await db
      .update(articles)
      .set({ domainExtras: {} })
      .where(eq(articles.id, testArticleId));

    let orchestratorCalled = false;
    const step = makeStepWithDeps(async () => {
      orchestratorCalled = true;
      return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshStages: 0, failures: 0, totalProviderCandidates: 0 } };
    });
    const result = await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "story-arc-clickbait",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect(orchestratorCalled).toBe(false);
    expect(result.familyBImages).toEqual([]);
  });

  it("skips orchestration when no provider credentials are configured", async () => {
    // Spec 65.16: story-arc-clickbait routes to nano-banana-2 by default.
    // Force photographic branch via content-level override so the credentials
    // check this test exercises actually fires.
    await db
      .update(articles)
      .set({
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: {
                rendered: "Wie ich als Texter meinen Job mit KI rettete",
                variables: { profession: "Texter", lifeArea: "Job" },
              },
              imageProvider: "photographic",
            },
          },
        },
      })
      .where(eq(articles.id, testArticleId));

    let orchestratorCalled = false;
    const step = new StageFamilyBImagesStep({
      loadCredentials: async () => ({ pexels: null, unsplash: null, pixabay: null }),
      runOrchestrator: async () => {
        orchestratorCalled = true;
        return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshStages: 0, failures: 0, totalProviderCandidates: 0 } };
      },
    });
    const result = await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "story-arc-clickbait",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect(orchestratorCalled).toBe(false);
    expect(result.familyBImages).toEqual([]);
  });

  it("happy path: invokes orchestrator, persists familyBImages to JSONB, returns in output", async () => {
    const stagedEntry = {
      slideIndex: 0,
      r2Key: "stage-family-b-test/articles/x/images/abc.webp",
      r2Url: "https://cdn.example.com/abc.webp",
      originalR2Key: null,
      license: {
        provider: "unsplash" as const,
        photographer: "Jane Doe",
        sourceUrl: "https://unsplash.com/photos/abc",
      },
      queryUsed: "frustrated copywriter at desk",
      cachedAt: new Date().toISOString(),
    };

    // Spec 65.16: story-arc-clickbait routes to nano-banana-2 by default.
    // Stamp content-level imageProvider override so this test stays on the
    // photographic path it was written for (still verifies the legacy
    // orchestrator wiring + jsonb_set persistence).
    await db
      .update(articles)
      .set({
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: {
                rendered: "Wie ich als Texter meinen Job mit KI rettete",
                variables: { profession: "Texter", lifeArea: "Job" },
              },
              imageProvider: "photographic",
            },
          },
        },
      })
      .where(eq(articles.id, testArticleId));

    let orchestratorInput: unknown = null;
    const step = new StageFamilyBImagesStep({
      loadCredentials: async () => ({
        pexels: { apiKey: "px" },
        unsplash: { accessKey: "uk" },
        pixabay: null,
      }),
      runOrchestrator: async (input) => {
        orchestratorInput = input;
        return {
          entries: [stagedEntry],
          failedSlideIndices: [],
          stats: { cacheHits: 0, freshStages: 1, failures: 0, totalProviderCandidates: 30 },
        };
      },
    });

    const result = await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "story-arc-clickbait",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );

    // Step output
    expect(result.familyBImages.length).toBe(1);
    expect(result.familyBImages[0]?.license.photographer).toBe("Jane Doe");
    expect(result.familyBImagesStats?.freshStages).toBe(1);

    // Orchestrator received the correct input
    const oInput = orchestratorInput as { slides: Array<{ slideIndex: number; narrativeBeat: string }>; formatType: string };
    expect(oInput.formatType).toBe("story-arc-clickbait");
    expect(oInput.slides.map((s) => s.slideIndex)).toEqual([0, 2, 3, 4]); // §3.7 Option γ
    expect(oInput.slides.map((s) => s.narrativeBeat)).toEqual([
      "cover",
      "conflict",
      "resolution",
      "payoff",
    ]);

    // Persisted to articles.domain_extras.familyBImages via jsonb_set
    const [row] = await db
      .select({ domainExtras: articles.domainExtras })
      .from(articles)
      .where(eq(articles.id, testArticleId))
      .limit(1);
    const extras = row?.domainExtras as Record<string, unknown>;
    expect(Array.isArray(extras.familyBImages)).toBe(true);
    expect((extras.familyBImages as unknown[]).length).toBe(1);
    // Sibling keys preserved (recurring stayed untouched)
    expect(extras.recurring).toBeDefined();
  });

  it("Spec 65.16: routes story-arc-clickbait to NB2 by default + persists familyBImages", async () => {
    const nb2Entry = {
      slideIndex: 0,
      r2Key: "stage-family-b-test/social/abc/slide-0/x.webp",
      r2Url: "https://cdn.example.com/x.webp",
      originalR2Key: null,
      license: {
        provider: "nano-banana-2" as const,
        photographer: null,
        sourceUrl: "https://cdn.example.com/x.webp",
      },
      queryUsed: "nb2:dark-neon-grid:cover",
      cachedAt: new Date().toISOString(),
    };

    let nb2Input: unknown = null;
    let photographicCalled = false;
    const step = new StageFamilyBImagesStep({
      // Photographic creds present — should NOT be touched by the NB2 branch
      loadCredentials: async () => ({ pexels: { apiKey: "x" }, unsplash: null, pixabay: null }),
      runOrchestrator: async () => {
        photographicCalled = true;
        return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshStages: 0, failures: 0, totalProviderCandidates: 0 } };
      },
      runNB2Orchestrator: async (input) => {
        nb2Input = input;
        return {
          entries: [nb2Entry],
          failedSlideIndices: [],
          stats: { cacheHits: 0, freshGenerations: 1, failures: 0 },
        };
      },
    });

    const result = await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "story-arc-clickbait",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );

    expect(photographicCalled).toBe(false);
    expect(result.familyBImages.length).toBe(1);
    expect(result.familyBImages[0]?.license.provider).toBe("nano-banana-2");
    // freshGenerations → freshStages remap for shape compat
    expect(result.familyBImagesStats?.freshStages).toBe(1);
    expect(result.familyBImagesStats?.totalProviderCandidates).toBe(0);

    // NB2 input received correct preset (project default) + slide map
    const ni = nb2Input as { preset: string; slides: Array<{ slideIndex: number; slideRole: string }> };
    expect(ni.preset).toBe("dark-neon-grid"); // project default after migration 0130
    expect(ni.slides.map((s) => s.slideIndex)).toEqual([0, 2, 3, 4]);
    expect(ni.slides.map((s) => s.slideRole)).toEqual([
      "cover",
      "conflict",
      "resolution",
      "payoff",
    ]);

    // Persisted to articles.domain_extras.familyBImages via jsonb_set
    const [row] = await db
      .select({ domainExtras: articles.domainExtras })
      .from(articles)
      .where(eq(articles.id, testArticleId))
      .limit(1);
    const extras = row?.domainExtras as Record<string, unknown>;
    expect(Array.isArray(extras.familyBImages)).toBe(true);
    expect((extras.familyBImages as unknown[]).length).toBe(1);
  });

  it("Spec 65.16: content-level imageStylePreset wins over project default", async () => {
    await db
      .update(articles)
      .set({
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: {
                rendered: "Hook",
                variables: { profession: "Texter", lifeArea: "Job" },
              },
              imageStylePreset: "blue-tech-gradient", // content-level override
            },
          },
        },
      })
      .where(eq(articles.id, testArticleId));

    let nb2Input: unknown = null;
    const step = new StageFamilyBImagesStep({
      loadCredentials: async () => ({ pexels: null, unsplash: null, pixabay: null }),
      runNB2Orchestrator: async (input) => {
        nb2Input = input;
        return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshGenerations: 0, failures: 0 } };
      },
    });
    await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "opinion-recommendation",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect((nb2Input as { preset: string }).preset).toBe("blue-tech-gradient");
  });

  it("Spec 65.16: lifestyle-listicle stays on photographic (Marcel-Decision §3.4)", async () => {
    let nb2Called = false;
    let photographicCalled = false;
    const step = new StageFamilyBImagesStep({
      loadCredentials: async () => ({ pexels: { apiKey: "x" }, unsplash: null, pixabay: null }),
      runOrchestrator: async () => {
        photographicCalled = true;
        return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshStages: 0, failures: 0, totalProviderCandidates: 0 } };
      },
      runNB2Orchestrator: async () => {
        nb2Called = true;
        return { entries: [], failedSlideIndices: [], stats: { cacheHits: 0, freshGenerations: 0, failures: 0 } };
      },
    });
    await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "lifestyle-listicle",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect(photographicCalled).toBe(true);
    expect(nb2Called).toBe(false);
  });

  it("forwards existing cache from domain_extras into the orchestrator", async () => {
    const cachedEntry = {
      slideIndex: 0,
      r2Key: "cached/x.webp",
      r2Url: "https://cdn.example.com/cached.webp",
      originalR2Key: null,
      license: {
        provider: "pixabay" as const,
        photographer: null,
        sourceUrl: "https://pixabay.com/photos/1/",
      },
      queryUsed: "test",
      cachedAt: "2026-05-25T00:00:00.000Z",
    };

    // Seed existing cache directly on the article
    await db
      .update(articles)
      .set({
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: {
                rendered: "Hook",
                variables: { profession: "Texter", lifeArea: "Job" },
              },
            },
          },
          familyBImages: [cachedEntry],
        },
      })
      .where(eq(articles.id, testArticleId));

    let receivedCache: unknown = null;
    const step = new StageFamilyBImagesStep({
      loadCredentials: async () => ({ pexels: { apiKey: "px" }, unsplash: null, pixabay: null }),
      runOrchestrator: async (input) => {
        receivedCache = input.existingCache;
        return {
          entries: input.existingCache as Array<typeof cachedEntry>,
          failedSlideIndices: [],
          stats: { cacheHits: 1, freshStages: 0, failures: 0, totalProviderCandidates: 0 },
        };
      },
    });
    await step.execute(
      {
        articleId: testArticleId,
        projectId: TEST_PROJECT_ID,
        projectSlug: TEST_PROJECT_SLUG,
        templateKeyOverride: "lifestyle-listicle",
      },
      makeMockCtx({ projectId: TEST_PROJECT_ID }),
    );
    expect(Array.isArray(receivedCache)).toBe(true);
    expect((receivedCache as Array<typeof cachedEntry>)[0]?.r2Key).toBe("cached/x.webp");
  });
});
