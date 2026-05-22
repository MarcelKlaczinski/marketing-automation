import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  buildFallbackHeroPrompt,
  pickDiverseByCollection,
  rebakeHeroSamples,
} from "../../src/scripts/rebake-hero-samples.ts";

/**
 * Spec 64.6d: smoke test for the rebake-hero-samples script.
 *
 * Dry-run only — no Gemini / Replicate calls. Verifies the picker diversifies
 * across collections and the fallback prompt fires for articles with outline=NULL.
 *
 * Live mode (--dry-run false) is acceptance #17 + #18 from the spec; verified
 * manually by Marcel after this PR merges. CI must stay free of paid API calls.
 */

const projectSlug = `rebake-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let projectId = "";

beforeAll(async () => {
  const [p] = await db
    .insert(projects)
    .values({
      slug: projectSlug,
      name: "Rebake Smoke Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning();
  projectId = p!.id;

  // Seed 6 articles across 3 collections (2 each). Picker should round-robin
  // and return 1 from each when asked for 3.
  await db.insert(articles).values([
    {
      projectId,
      slug: "blog-one",
      title: "Blog One",
      collection: "blog",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
    {
      projectId,
      slug: "blog-two",
      title: "Blog Two",
      collection: "blog",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
    {
      projectId,
      slug: "comp-one",
      title: "Comp One",
      collection: "comparisons",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
    {
      projectId,
      slug: "comp-two",
      title: "Comp Two",
      collection: "comparisons",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
    {
      projectId,
      slug: "kw-one",
      title: "Wissen One",
      collection: "ki-wissen",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
    {
      projectId,
      slug: "kw-two",
      title: "Wissen Two",
      collection: "ki-wissen",
      locale: "de",
      source: "imported",
      status: "published",
      bodyMd: "",
    },
  ]);
});

afterAll(async () => {
  // CASCADE on projectId → articles cleaned up too.
  if (projectId) {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});

describe("rebake-hero-samples (Spec 64.6d, dry-run only)", () => {
  it("picks N articles diversified across collections", async () => {
    const result = await rebakeHeroSamples({
      projectSlug,
      count: 3,
      collections: ["blog", "comparisons", "ki-wissen"],
      dryRun: true,
    });

    expect(result.previewedSlugs).toHaveLength(3);
    // All 3 collections represented since round-robin picks 1 from each before
    // looping back. With 6 candidates (2 per collection) and target=3, we
    // deterministically get all 3 unique collections.
    expect(result.previewedCollections.sort()).toEqual(["blog", "comparisons", "ki-wissen"]);
    expect(result.bakedSlugs).toHaveLength(0); // dry-run skips adapter calls
    expect(result.failedSlugs).toHaveLength(0);
  });

  it("respects the --collections allow-list (omits ki-wissen when not allowed)", async () => {
    const result = await rebakeHeroSamples({
      projectSlug,
      count: 2,
      collections: ["blog", "comparisons"],
      dryRun: true,
    });

    expect(result.previewedSlugs).toHaveLength(2);
    expect(result.previewedCollections.sort()).toEqual(["blog", "comparisons"]);
  });

  it("falls back to default allow-list when --collections is omitted", async () => {
    const result = await rebakeHeroSamples({
      projectSlug,
      count: 3,
      dryRun: true,
    });

    expect(result.previewedSlugs).toHaveLength(3);
    // Default list includes all 3 of our seeded collections.
    expect(result.previewedCollections.length).toBeGreaterThanOrEqual(2);
  });

  it("throws when --project does not match a real project", async () => {
    await expect(
      rebakeHeroSamples({
        projectSlug: "definitely-not-a-real-project-12345",
        count: 3,
        dryRun: true,
      }),
    ).rejects.toThrow(/Project not found/);
  });
});

describe("pickDiverseByCollection (Spec 64.6d unit)", () => {
  it("rounds through collections one at a time", () => {
    const pool = [
      { id: "1", slug: "a", title: "A", collection: "blog", outline: null },
      { id: "2", slug: "b", title: "B", collection: "blog", outline: null },
      { id: "3", slug: "c", title: "C", collection: "blog", outline: null },
      { id: "4", slug: "d", title: "D", collection: "tools", outline: null },
      { id: "5", slug: "e", title: "E", collection: "tools", outline: null },
    ];
    const picked = pickDiverseByCollection(pool, 4);
    expect(picked).toHaveLength(4);
    const collections = picked.map((a) => a.collection);
    // First pick = blog, second = tools, third = blog (round 2), fourth = tools (round 2).
    expect(new Set(collections.slice(0, 2))).toEqual(new Set(["blog", "tools"]));
  });

  it("gracefully handles target > pool size", () => {
    const pool = [
      { id: "1", slug: "a", title: "A", collection: "blog", outline: null },
      { id: "2", slug: "b", title: "B", collection: "tools", outline: null },
    ];
    const picked = pickDiverseByCollection(pool, 10);
    expect(picked).toHaveLength(2); // Returns everything available, no infinite loop.
  });

  it("returns empty array for empty pool", () => {
    expect(pickDiverseByCollection([], 5)).toEqual([]);
  });
});

describe("buildFallbackHeroPrompt (Spec 64.6d unit)", () => {
  it("includes title + collection in the synthesized prompt", () => {
    const prompt = buildFallbackHeroPrompt({ title: "Claude vs GPT", collection: "comparisons" });
    expect(prompt).toContain("Claude vs GPT");
    expect(prompt).toContain("comparisons");
  });

  it("forbids text labels (mirrors outline.ts Rule 6 for Nano Banana 2)", () => {
    const prompt = buildFallbackHeroPrompt({ title: "x", collection: "blog" });
    expect(prompt).toMatch(/NO text labels/i);
  });
});
