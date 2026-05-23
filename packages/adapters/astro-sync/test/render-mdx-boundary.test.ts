/**
 * Spec multi-domain-evolution S1.2 — boundary validator integration test for
 * RenderMdxStep. Verifies that the new AstroSyncValidationError throws on
 * schema-drift between Tool-generated frontmatter and Astro-declared schema.
 *
 * No DB / GitHub needed — RenderMdxStep is pure in-memory composition.
 */
import { describe, expect, it } from "bun:test";
import type { StepContext } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { AstroSyncValidationError, RenderMdxStep } from "../src/index.ts";
import type { FrontmatterField } from "../src/types.ts";

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
}) {
  return {
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
      frontmatterExtras: overrides.extras ?? { excerpt: "Brief intro" },
      category: overrides.category ?? "Vergleiche",
      subcategory: null,
      tags: overrides.tags ?? ["ai", "ml"],
      author: "anna-weidner",
      intentType: "comparison",
      locale: "de",
      collectionType: "blog",
    },
    cluster: { name: "AI Tools", pillar: "AI Pillar" },
    collectionInfo: { collectionName: "blog", fields: BLOG_FIELDS },
    heroPublicPath: "/gen/test-article/hero.webp",
    astroRepoRoot: "src/content",
  };
}

describe("RenderMdxStep boundary validator (Spec multi-domain-evolution S1.2)", () => {
  const step = new RenderMdxStep();

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
    // Inject a bad type via frontmatterExtras — buildFrontmatter passes extras
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
