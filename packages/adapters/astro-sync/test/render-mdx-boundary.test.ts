/**
 * Spec multi-domain-evolution S1.2 + Domain-Registry follow-up — boundary
 * validator integration test for RenderMdxStep. Verifies:
 *   (S1.2) AstroSyncValidationError throws on schema-drift between
 *          Tool-generated frontmatter and Astro-declared schema.
 *   (DR)   The registry-level allowed-collections gate throws
 *          collection_not_in_registry when the project's DomainSpec
 *          doesn't register the target collection. Null-registry
 *          fall-through preserves legacy Spec-50-only behavior.
 *
 * No DB / GitHub needed — RenderMdxStep is pure in-memory composition;
 * the registry is stubbed via `setDomainRegistryForTesting`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StepContext } from "@marketing-auto/pipelines";
import {
  resetDomainRegistryForTesting,
  setDomainRegistryForTesting,
} from "@marketing-auto/pipelines/domain-registry";
import { toolwikiDomain } from "@marketing-auto/content-schema/domains/toolwiki";
import {
  createDbBackedRegistry,
  type ProjectLookup,
} from "@marketing-auto/content-schema/registry";
import { createLogger } from "@marketing-auto/shared";
import { AstroSyncValidationError, RenderMdxStep } from "../src/index.ts";
import type { FrontmatterField } from "../src/types.ts";

const TOOLWIKI_PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const BK_PROJECT_ID = "33333333-3333-3333-3333-333333333333";
const UNREGISTERED_PROJECT_ID = "44444444-4444-4444-4444-444444444444";

/**
 * Stub ProjectLookup — no DB. Maps the three synthetic projectIds above
 * to fixture domain contexts, returns null for everything else (which
 * exercises the legacy Spec-50-only fall-through).
 */
const stubProjectLookup: ProjectLookup = {
  async resolve(projectId) {
    if (projectId === TOOLWIKI_PROJECT_ID) {
      return {
        niche: "ai-tool-wiki",
        domain: "toolwiki.ai",
        locales: ["de", "en"] as const,
      };
    }
    if (projectId === BK_PROJECT_ID) {
      // BK is a synthetic future tenant — niche won't match any registered
      // DomainSpec because we only register `toolwikiDomain` below.
      return {
        niche: "solar-energy",
        domain: "balkon-kraft-werk.de",
        locales: ["de"] as const,
      };
    }
    return null;
  },
};

// Spec 62.0a-followup Issue 6 — local wrapper for the cross-package
// makeMockCtx. Same defaults; widen here when StepContext grows a new field.
const mockCtx = (overrides: Partial<StepContext> = {}): StepContext => ({
  projectId: "00000000-0000-0000-0000-000000000000",
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  llmMode: "sync",
  runMode: "production",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
  ...overrides,
});

// Realistic blog-collection schema — mirrors what ResolveSchemaStep returns
// for the live Toolwiki blog collection.
const BLOG_FIELDS: FrontmatterField[] = [
  { name: "title", type: "string", required: true, hasDefault: false },
  { name: "description", type: "string", required: true, hasDefault: false },
  { name: "date", type: "date", required: true, hasDefault: false },
  { name: "heroImage", type: "image", required: true, hasDefault: false },
  { name: "heroImageAlt", type: "string", required: false, hasDefault: false },
  {
    name: "category",
    type: "string",
    required: true,
    hasDefault: false,
    enumValues: ["Guides & Tutorials", "Vergleiche", "Praxis & Use Cases"],
  },
  { name: "tags", type: "string_array", required: false, hasDefault: true },
  { name: "featured", type: "boolean", required: false, hasDefault: true },
  { name: "wordCount", type: "number", required: false, hasDefault: false },
];

function buildInput(overrides: {
  category?: string | null;
  extras?: Record<string, unknown>;
  tags?: string[] | null;
  projectId?: string;
  collectionType?: string;
}) {
  return {
    projectId: overrides.projectId ?? UNREGISTERED_PROJECT_ID,
    article: {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Test Article",
      slug: "test-article",
      metaDescription: "A test article for boundary validation.",
      bodyMd: "Some markdown body.",
      cornerstoneKeyword: "ki-tools",
      heroImageAltText: "Hero alt text",
      schemaJsonLd: [{ "@type": "Article" }],
      wordCount: 1200,
      domainExtras: overrides.extras ?? { excerpt: "Brief intro" },
      category: overrides.category ?? "Vergleiche",
      subcategory: null,
      tags: overrides.tags ?? ["ai", "ml"],
      author: "anna-weidner",
      intentType: "comparison",
      locale: "de",
      collectionType: overrides.collectionType ?? "blog",
    },
    cluster: { name: "AI Tools", pillar: "AI Pillar" },
    collectionInfo: { collectionName: "blog", fields: BLOG_FIELDS },
    heroPublicPath: "/gen/test-article/hero.webp",
    astroRepoRoot: "src/content",
  };
}

describe("RenderMdxStep boundary validator (Spec multi-domain-evolution S1.2)", () => {
  const step = new RenderMdxStep();

  // Existing S1.2 tests run against UNREGISTERED_PROJECT_ID → registry returns
  // null → fall-through to the field-shape validator. Inject a stub registry
  // (no DB) and reset between tests so the singleton state is clean.
  beforeEach(() => {
    setDomainRegistryForTesting(
      createDbBackedRegistry([toolwikiDomain], stubProjectLookup),
    );
  });

  afterEach(() => {
    resetDomainRegistryForTesting();
  });

  it("passes a valid Toolwiki blog article through to MDX", async () => {
    const input = buildInput({});
    const out = await step.execute(input, mockCtx());
    expect(out.mdxPath).toBe("src/content/blog/test-article.mdx");
    expect(out.mdxContent).toContain("\"title\": \"Test Article\"");
    expect(out.unpopulatedRequired).toEqual([]);
  });

  it("throws AstroSyncValidationError when category violates the enum", async () => {
    const input = buildInput({ category: "Not-A-Valid-Category" });
    let caught: unknown;
    try {
      await step.execute(input, mockCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AstroSyncValidationError);
    const err = caught as AstroSyncValidationError;
    expect(err.articleId).toBe("11111111-1111-1111-1111-111111111111");
    expect(err.collection).toBe("blog");
    const cat = err.failures.find((f) => f.fieldPath === "category");
    expect(cat?.reason).toBe("enum_mismatch");
    expect(cat?.actual).toBe("Not-A-Valid-Category");
  });

  it("throws when a required field is missing (tags array with wrong shape)", async () => {
    // Inject a bad type via domainExtras — buildFrontmatter passes extras
    // through. tags being a non-array string is a type_mismatch on string_array.
    // Also pass a non-string array on the column so the extras→column→known
    // merge in buildFrontmatter doesn't fall back to an empty array.
    const input = buildInput({ extras: { tags: "not-an-array" as unknown as string[] } });
    (input.article as { tags: unknown }).tags = null;
    let caught: unknown;
    try {
      await step.execute(input, mockCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AstroSyncValidationError);
    const err = caught as AstroSyncValidationError;
    const tagsFail = err.failures.find((f) => f.fieldPath === "tags");
    expect(tagsFail?.reason).toBe("type_mismatch");
    expect(tagsFail?.expected).toBe("string[]");
  });

  it("emits structured failures so S1.3 notifications can format them", async () => {
    const input = buildInput({ category: "Wrong-Enum" });
    try {
      await step.execute(input, mockCtx());
      expect(false).toBe(true); // unreachable
    } catch (e) {
      if (!(e instanceof AstroSyncValidationError)) throw e;
      // Each failure has the exact shape the spec requires for the notify payload.
      for (const f of e.failures) {
        expect(typeof f.fieldPath).toBe("string");
        expect(typeof f.expected).toBe("string");
        expect(typeof f.actual).toBe("string");
        expect(["missing_required", "type_mismatch", "enum_mismatch"]).toContain(f.reason);
      }
      // Message is human-readable
      expect(e.message).toContain("Astro-Sync boundary validation failed");
      expect(e.message).toContain("blog");
    }
  });

  it("permissive fallback: empty schema does not throw (matches existing buildFrontmatter behavior)", async () => {
    const input = buildInput({});
    input.collectionInfo.fields = [];
    const out = await step.execute(input, mockCtx());
    expect(out.mdxContent).toContain("\"title\": \"Test Article\"");
  });
});

describe("RenderMdxStep registry allowed-collections gate (Domain-Registry follow-up)", () => {
  const step = new RenderMdxStep();

  beforeEach(() => {
    setDomainRegistryForTesting(
      createDbBackedRegistry([toolwikiDomain], stubProjectLookup),
    );
  });

  afterEach(() => {
    resetDomainRegistryForTesting();
  });

  it("Toolwiki project passes when collectionType is in the spec allow-list", async () => {
    const input = buildInput({
      projectId: TOOLWIKI_PROJECT_ID,
      collectionType: "blog",
    });
    const out = await step.execute(input, mockCtx({ projectId: TOOLWIKI_PROJECT_ID }));
    expect(out.mdxPath).toBe("src/content/blog/test-article.mdx");
  });

  it("Synthetic BK project rejects unknown collection with collection_not_in_registry", async () => {
    // BK's projectLookup resolves niche=solar-energy, but we only register
    // toolwikiDomain in the stub registry — so forProject returns null and
    // we skip the gate. To exercise the rejection path we need the niche
    // to MATCH a registered DomainSpec but the collection NOT to be in
    // its allow-list. Build that case by routing BK through toolwiki's
    // niche but asking for a synthetic "products" collection that no
    // DomainSpec registers.
    const customLookup: ProjectLookup = {
      async resolve(projectId) {
        if (projectId === BK_PROJECT_ID) {
          return { niche: "ai-tool-wiki", domain: "balkon-kraft-werk.de", locales: ["de"] as const };
        }
        return null;
      },
    };
    setDomainRegistryForTesting(createDbBackedRegistry([toolwikiDomain], customLookup));

    const input = buildInput({
      projectId: BK_PROJECT_ID,
      collectionType: "products", // not in toolwikiDomain.collections
    });
    let caught: unknown;
    try {
      await step.execute(input, mockCtx({ projectId: BK_PROJECT_ID }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AstroSyncValidationError);
    const err = caught as AstroSyncValidationError;
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0]?.fieldPath).toBe("collection_type");
    expect(err.failures[0]?.reason).toBe("collection_not_in_registry");
    expect(err.failures[0]?.actual).toBe("products");
    expect(err.failures[0]?.expected).toContain("blog");
  });

  it("Null-registry fall-through preserves legacy Spec-50-only validation (no extra throw)", async () => {
    // UNREGISTERED_PROJECT_ID is not in the stubProjectLookup, so
    // forProject returns null → the gate is skipped entirely. The Spec-50
    // field-shape validator still runs and passes on a well-formed input.
    const input = buildInput({ projectId: UNREGISTERED_PROJECT_ID });
    const out = await step.execute(input, mockCtx({ projectId: UNREGISTERED_PROJECT_ID }));
    expect(out.mdxPath).toBe("src/content/blog/test-article.mdx");
  });

  it("Null-registry fall-through still surfaces Spec-50 field violations", async () => {
    // Confirms the gate is independent of the field-shape validator: a
    // missing-field violation under null-registry still throws S1.2.
    const input = buildInput({
      projectId: UNREGISTERED_PROJECT_ID,
      category: "Not-A-Valid-Category",
    });
    let caught: unknown;
    try {
      await step.execute(input, mockCtx({ projectId: UNREGISTERED_PROJECT_ID }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AstroSyncValidationError);
    const err = caught as AstroSyncValidationError;
    // Existing S1.2 path — NOT a collection_not_in_registry failure.
    expect(err.failures.some((f) => f.reason === "enum_mismatch")).toBe(true);
    expect(err.failures.some((f) => f.reason === "collection_not_in_registry")).toBe(false);
  });
});
