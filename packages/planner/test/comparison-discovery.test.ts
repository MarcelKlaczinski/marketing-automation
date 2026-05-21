// Spec 62.3: discoverComparisonPairs() unit tests.
// Real DB fixtures: project + tools-collection articles + blog/comparison articles +
// article_discovery rows with referencedTools. Asserts canonicalization, scoring,
// dedup, and exclusion of existing comparison articles.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  and,
  articleDiscovery,
  articles,
  db,
  eq,
  inArray,
  topicBriefs,
} from "@marketing-auto/db";
import { computePairScore, discoverComparisonPairs } from "../src/index.ts";

let projectId: string;
const articleIds: string[] = [];

async function freshProject(): Promise<string> {
  const { projects } = await import("@marketing-auto/db");
  const [row] = await db
    .insert(projects)
    .values({
      slug: `cd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "comparison-discovery-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  if (!row) throw new Error("project insert failed");
  return row.id;
}

async function makeTool(
  projectId: string,
  slug: string,
  title: string,
  category: string | null,
): Promise<string> {
  const [row] = await db
    .insert(articles)
    .values({
      projectId,
      slug,
      title,
      collection: "tools",
      source: "imported",
      // Spec 63.3b (post-investigation): seed `articles.category` directly. The
      // discovery's `loadToolInfo` reads the top-level column now, not the
      // frontmatterExtras blob (Spec 54.8 promotion). We still set
      // frontmatterExtras to `{}` so other rows don't carry stale data.
      ...(category !== null ? { category, frontmatterExtras: {} } : { frontmatterExtras: {} }),
    })
    .returning({ id: articles.id });
  if (!row) throw new Error("tool article insert failed");
  articleIds.push(row.id);
  return row.id;
}

async function makeBlogWithTools(
  projectId: string,
  slug: string,
  toolSlugs: string[],
  publishedAt: Date = new Date(),
): Promise<string> {
  const [art] = await db
    .insert(articles)
    .values({
      projectId,
      slug,
      title: slug,
      collection: "blog",
      source: "imported",
      publishedAt,
      frontmatterExtras: {},
    })
    .returning({ id: articles.id });
  if (!art) throw new Error("blog article insert failed");
  articleIds.push(art.id);
  await db.insert(articleDiscovery).values({
    articleId: art.id,
    referencedTools: toolSlugs,
  });
  return art.id;
}

async function makeComparisonCovering(
  projectId: string,
  slug: string,
  toolSlugs: string[],
): Promise<string> {
  const [art] = await db
    .insert(articles)
    .values({
      projectId,
      slug,
      title: slug,
      collection: "comparisons",
      source: "imported",
      frontmatterExtras: { toolSlugs },
    })
    .returning({ id: articles.id });
  if (!art) throw new Error("comparison article insert failed");
  articleIds.push(art.id);
  return art.id;
}

beforeEach(async () => {
  projectId = await freshProject();
  articleIds.length = 0;
});

afterEach(async () => {
  // Clean up children before project (CASCADE handles most, but be explicit).
  if (articleIds.length > 0) {
    await db.delete(articleDiscovery).where(inArray(articleDiscovery.articleId, articleIds));
    await db.delete(articles).where(inArray(articles.id, articleIds));
  }
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  const { projects } = await import("@marketing-auto/db");
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("discoverComparisonPairs", () => {
  it("returns 0 pairs when no co-mentions exist", async () => {
    await makeTool(projectId, "claude", "Claude", "AI");
    await makeTool(projectId, "gpt-4", "GPT-4", "AI");

    const result = await discoverComparisonPairs({ projectId });
    expect(result.pairsFound).toBe(0);
    expect(result.pairsPersisted).toBe(0);
  });

  it("filters out pairs below minCoMentionCount (default 2)", async () => {
    await makeTool(projectId, "claude", "Claude", "AI");
    await makeTool(projectId, "gpt-4", "GPT-4", "AI");
    // Only 1 article co-mentions the pair → below default min=2
    await makeBlogWithTools(projectId, "article-1", ["claude", "gpt-4"]);

    const result = await discoverComparisonPairs({ projectId });
    expect(result.pairsFound).toBe(1);
    expect(result.pairsAboveThreshold).toBe(0);
    expect(result.pairsPersisted).toBe(0);
  });

  it("persists canonicalized pairs (toolASlug < toolBSlug)", async () => {
    await makeTool(projectId, "midjourney", "Midjourney", "AI");
    await makeTool(projectId, "dalle", "DALL-E", "AI");
    // First article lists tools in (b, a) order; canonicalization should still produce a<b.
    await makeBlogWithTools(projectId, "art1", ["midjourney", "dalle"]);
    await makeBlogWithTools(projectId, "art2", ["dalle", "midjourney"]);

    const result = await discoverComparisonPairs({ projectId, minScore: 0 });
    expect(result.pairsPersisted).toBe(1);

    const persisted = await db
      .select({ comparisonMetadata: topicBriefs.comparisonMetadata })
      .from(topicBriefs)
      .where(and(eq(topicBriefs.projectId, projectId), eq(topicBriefs.source, "comparison_discovery")));

    expect(persisted).toHaveLength(1);
    const meta = persisted[0]?.comparisonMetadata;
    expect(meta?.toolASlug).toBe("dalle");
    expect(meta?.toolBSlug).toBe("midjourney");
    expect(meta?.toolASlug! < meta?.toolBSlug!).toBe(true);
  });

  it("score includes categoryOverlap boost when both tools share a category", async () => {
    await makeTool(projectId, "tool-a", "Tool A", "Image AI");
    await makeTool(projectId, "tool-b", "Tool B", "Image AI");
    await makeTool(projectId, "tool-c", "Tool C", "Text AI");

    await makeBlogWithTools(projectId, "art-ab-1", ["tool-a", "tool-b"]);
    await makeBlogWithTools(projectId, "art-ab-2", ["tool-a", "tool-b"]);
    await makeBlogWithTools(projectId, "art-ac-1", ["tool-a", "tool-c"]);
    await makeBlogWithTools(projectId, "art-ac-2", ["tool-a", "tool-c"]);

    const result = await discoverComparisonPairs({ projectId, minScore: 0 });
    const ab = result.topPairs.find((p) => p.toolASlug === "tool-a" && p.toolBSlug === "tool-b");
    const ac = result.topPairs.find((p) => p.toolASlug === "tool-a" && p.toolBSlug === "tool-c");

    // Same coMentionCount, but ab has categoryOverlap → score higher
    expect(ab?.categoryOverlap).toBe(true);
    expect(ac?.categoryOverlap).toBe(false);
    expect((ab?.score ?? 0) - (ac?.score ?? 0)).toBeGreaterThan(0);
  });

  it("excludes pairs already covered by an existing comparison article", async () => {
    await makeTool(projectId, "claude", "Claude", "AI");
    await makeTool(projectId, "gpt-4", "GPT-4", "AI");
    await makeBlogWithTools(projectId, "a", ["claude", "gpt-4"]);
    await makeBlogWithTools(projectId, "b", ["claude", "gpt-4"]);
    // Add an existing comparison article that covers (claude, gpt-4)
    await makeComparisonCovering(projectId, "claude-vs-gpt-4", ["claude", "gpt-4"]);

    const result = await discoverComparisonPairs({ projectId, minScore: 0 });
    expect(result.pairsAboveThreshold).toBeGreaterThanOrEqual(1);
    expect(result.pairsPersisted).toBe(0);
  });

  it("opt-out of exclusion via excludeExistingComparisons=false", async () => {
    await makeTool(projectId, "claude", "Claude", "AI");
    await makeTool(projectId, "gpt-4", "GPT-4", "AI");
    await makeBlogWithTools(projectId, "a", ["claude", "gpt-4"]);
    await makeBlogWithTools(projectId, "b", ["claude", "gpt-4"]);
    await makeComparisonCovering(projectId, "claude-vs-gpt-4", ["claude", "gpt-4"]);

    const result = await discoverComparisonPairs({
      projectId,
      minScore: 0,
      excludeExistingComparisons: false,
    });
    expect(result.pairsPersisted).toBe(1);
  });

  it("second run with the same data UPSERTs (no duplicate rows)", async () => {
    await makeTool(projectId, "alpha", "Alpha", "AI");
    await makeTool(projectId, "beta", "Beta", "AI");
    await makeBlogWithTools(projectId, "art1", ["alpha", "beta"]);
    await makeBlogWithTools(projectId, "art2", ["alpha", "beta"]);

    const r1 = await discoverComparisonPairs({ projectId, minScore: 0 });
    expect(r1.pairsPersisted).toBe(1);

    const r2 = await discoverComparisonPairs({ projectId, minScore: 0 });
    expect(r2.pairsPersisted).toBe(1);

    const rows = await db
      .select({ id: topicBriefs.id })
      .from(topicBriefs)
      .where(and(eq(topicBriefs.projectId, projectId), eq(topicBriefs.source, "comparison_discovery")));
    expect(rows).toHaveLength(1);
  });

  it("respects minScore filter", async () => {
    await makeTool(projectId, "x", "X", null);
    await makeTool(projectId, "y", "Y", null);
    await makeBlogWithTools(projectId, "art1", ["x", "y"]);
    await makeBlogWithTools(projectId, "art2", ["x", "y"]);

    // minScore very high → no pairs persisted
    const result = await discoverComparisonPairs({ projectId, minScore: 0.99 });
    expect(result.pairsAboveThreshold).toBe(0);
    expect(result.pairsPersisted).toBe(0);
  });

  it("self-pairs are skipped (tool referenced alongside itself)", async () => {
    await makeTool(projectId, "lonely", "Lonely Tool", "AI");
    // Article references the same tool twice in the referenced_tools array
    await makeBlogWithTools(projectId, "art1", ["lonely", "lonely"]);
    await makeBlogWithTools(projectId, "art2", ["lonely", "lonely"]);

    const result = await discoverComparisonPairs({ projectId });
    expect(result.pairsFound).toBe(0);
  });

  it("returns topPairs sorted by score descending", async () => {
    await makeTool(projectId, "a", "A", "X");
    await makeTool(projectId, "b", "B", "X");
    await makeTool(projectId, "c", "C", "Y");
    // Pair (a,b) gets 3 co-mentions + category overlap.
    await makeBlogWithTools(projectId, "ab1", ["a", "b"]);
    await makeBlogWithTools(projectId, "ab2", ["a", "b"]);
    await makeBlogWithTools(projectId, "ab3", ["a", "b"]);
    // Pair (a,c) gets 2 co-mentions, no category overlap.
    await makeBlogWithTools(projectId, "ac1", ["a", "c"]);
    await makeBlogWithTools(projectId, "ac2", ["a", "c"]);

    const result = await discoverComparisonPairs({ projectId, minScore: 0 });
    expect(result.topPairs.length).toBeGreaterThanOrEqual(2);
    expect(result.topPairs[0]?.score).toBeGreaterThanOrEqual(result.topPairs[1]?.score ?? 0);
  });
});

// Spec 63.3b: pure unit tests on the score formula (no DB).
describe("computePairScore (Spec 63.3b)", () => {
  it("same-category pair scores higher than cross-category pair with identical co-mentions", () => {
    const sameCategory = computePairScore({
      coMentionCount: 10,
      maxCoMention: 28,
      categoryOverlap: true,
      recencyBoost: 1.0,
    });
    const crossCategory = computePairScore({
      coMentionCount: 10,
      maxCoMention: 28,
      categoryOverlap: false,
      recencyBoost: 1.0,
    });
    expect(sameCategory).toBeGreaterThan(crossCategory);
    // Specific delta: bonus(0.4) - (-penalty(0.05)) = 0.45.
    expect(sameCategory - crossCategory).toBeCloseTo(0.45, 3);
  });

  it("cross-category pair with mid co-mentions falls under default threshold (0.3)", () => {
    // 8/28 ≈ 0.286 → 0.286*0.4 + (-0.05) + 1.0*0.2 = 0.114 + (-0.05) + 0.2 ≈ 0.264
    const cross = computePairScore({
      coMentionCount: 8,
      maxCoMention: 28,
      categoryOverlap: false,
      recencyBoost: 1.0,
    });
    expect(cross).toBeLessThan(0.3);
  });

  it("strong same-category pair stays above default threshold (0.3)", () => {
    // 12/28 ≈ 0.429 → 0.429*0.4 + 0.4 + 1.0*0.2 = 0.171 + 0.4 + 0.2 ≈ 0.771
    const strong = computePairScore({
      coMentionCount: 12,
      maxCoMention: 28,
      categoryOverlap: true,
      recencyBoost: 1.0,
    });
    expect(strong).toBeGreaterThan(0.3);
  });

  it("honours bespoke weights (caller can tune knobs)", () => {
    // With pre-63.3b weights (no penalty, 0.2 category bonus, 0.6 co-mention),
    // the same cross-category mid-co-mention pair should score higher.
    const pre633b = computePairScore(
      { coMentionCount: 8, maxCoMention: 28, categoryOverlap: false, recencyBoost: 1.0 },
      { coMentionWeight: 0.6, categoryOverlapBonus: 0.2, crossCategoryPenalty: 0, recencyWeight: 0.2 },
    );
    const post633b = computePairScore({
      coMentionCount: 8,
      maxCoMention: 28,
      categoryOverlap: false,
      recencyBoost: 1.0,
    });
    expect(pre633b).toBeGreaterThan(post633b);
  });
});
