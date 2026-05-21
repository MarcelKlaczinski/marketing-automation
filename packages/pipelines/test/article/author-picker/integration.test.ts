import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { db, projects, articles, contentPillars, clusters, eq } from "@marketing-auto/db";
import { pickAuthor } from "../../../src/article/author-picker/index.ts";
import type { TopicBrief } from "@marketing-auto/db";

const RUN_DB = process.env.RUN_DB_TESTS === "1";

function makeBrief(overrides: Partial<TopicBrief> = {}): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId: overrides.projectId ?? crypto.randomUUID(),
    source: "trend_discovery",
    topicTitle: "KI-Tools für Entwickler",
    primaryKeyword: "ki entwickler tools",
    secondaryKeywords: ["github copilot", "cursor", "ai ide"],
    locale: "de",
    intentType: "review",
    clusterId: overrides.clusterId ?? null,
    clusterAction: "append_to_existing",
    approvalRequired: true,
    approvalStatus: "approved",
    gapId: null,
    searchVolumeDe: null,
    searchVolumeEn: null,
    difficulty: null,
    serpSnapshot: null,
    suggestedTitle: null,
    suggestedSlug: null,
    suggestedMeta: null,
    heroImagePrompt: null,
    generationMode: null,
    approvedBy: null,
    approvedAt: null,
    gapMetadata: null,
    trendMetadata: null,
    refreshMetadata: null,
    comparisonMetadata: null,
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe.skipIf(!RUN_DB)("pickAuthor integration (DB)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-pick-author-${Date.now()}`,
        name: "test-pick-author-integration",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    // Create pillar + cluster so the FK on articles.cluster_id is satisfied
    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "Test Pillar" })
      .returning({ id: contentPillars.id });
    const [cluster] = await db
      .insert(clusters)
      .values({ projectId, pillarId: pillar!.id, name: "Test Cluster" })
      .returning({ id: clusters.id });
    clusterId = cluster!.id;

    // lukas has strong cluster+intent signal
    const seeds: Array<{ author: string; intentType: string; clId: string | null }> = [
      { author: "lukas-hoffmann", intentType: "review", clId: clusterId },
      { author: "lukas-hoffmann", intentType: "review", clId: clusterId },
      { author: "anna-weidner",   intentType: "review", clId: null },
    ];
    for (const s of seeds) {
      await db.insert(articles).values({
        projectId,
        slug: `art-${Math.random().toString(36).slice(2)}`,
        title: "Test Blog Article",
        collection: "blog",
        source: "imported",
        locale: "de",
        author: s.author,
        intentType: s.intentType,
        ...(s.clId !== null ? { clusterId: s.clId } : {}),
      });
    }

    // Author profile for lukas
    await db.insert(articles).values({
      projectId,
      slug: "lukas-hoffmann",
      title: "Lukas Hoffmann",
      collection: "authors",
      locale: "de",
    });
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("uses historic_score when cluster+intent signal exists", async () => {
    const brief = makeBrief({ projectId, clusterId });
    const result = await pickAuthor(projectId, brief);
    expect(result.matchStrategy).toBe("historic_score");
    expect(result.authorSlug).toBe("lukas-hoffmann");
    expect(result.matchScore).toBeGreaterThan(0);
  });

  it("falls to default_fallback when no cluster or intent signal matches", async () => {
    const brief = makeBrief({
      projectId,
      clusterId: crypto.randomUUID(), // unknown cluster
      intentType: "comparison",       // no articles with this intent
    });
    const result = await pickAuthor(projectId, brief);
    // No historic match, no author expertise embeddings → default fallback
    // Dynamic fallback picks author with most imported blog posts: lukas-hoffmann (2) > anna-weidner (1)
    // anna-weidner has no authors collection entry so lukas-hoffmann wins.
    expect(result.matchStrategy).toBe("default_fallback");
    expect(result.authorSlug).toBe("lukas-hoffmann");
  });

  it("result always has non-null authorSlug", async () => {
    const brief = makeBrief({ projectId });
    const result = await pickAuthor(projectId, brief);
    expect(result.authorSlug).toBeTruthy();
    expect(result.authorName).toBeTruthy();
  });

  it("matchStrategy is one of the three known values", async () => {
    const brief = makeBrief({ projectId });
    const result = await pickAuthor(projectId, brief);
    expect(["historic_score", "embedding_fallback", "default_fallback"]).toContain(
      result.matchStrategy
    );
  });
});
