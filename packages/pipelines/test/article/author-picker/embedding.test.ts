import { describe, expect, it, beforeAll, afterAll, mock } from "bun:test";
import { db, projects, articles, eq } from "@marketing-auto/db";
import { voyage } from "@marketing-auto/adapter-voyage";

// ─── Pure cosine similarity (no DB, no API) ───────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("cosineSimilarity", () => {
  it("identical vectors → similarity 1.0", () => {
    const v = [0.5, 0.3, 0.8, 0.1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("orthogonal vectors → similarity 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it("opposite vectors → similarity -1.0", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  it("zero vector → similarity 0 (no crash)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("similar but not identical vectors → similarity between 0 and 1", () => {
    const sim = cosineSimilarity([1, 0.9, 0.8], [0.9, 1, 0.7]);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });
});

// ─── embeddingAuthorMatch with real DB + mocked voyage ────────────────────────

const RUN_DB = process.env.RUN_DB_TESTS === "1";

// 4-dim embeddings for test simplicity (production uses 1024-dim voyage-3)
const HIGH_SIM_VEC = [1, 0, 0, 0]; // cosine sim ≈ 1.0 against query [1,0,0,0]
const LOW_SIM_VEC  = [0, 1, 0, 0]; // cosine sim = 0.0 against query [1,0,0,0]

describe.skipIf(!RUN_DB)("embeddingAuthorMatch (DB + mocked voyage)", () => {
  let projectId: string;
  let embedCallCount = 0;

  beforeAll(async () => {
    // Seed project
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-embed-picker-${Date.now()}`,
        name: "test-embed-picker",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    // Author "high-match" has expertise embedding already cached → only cosine computed
    await db.insert(articles).values({
      projectId,
      slug: "high-match-author",
      title: "High Match Author",
      collection: "authors",
      locale: "de",
      domainExtras: {
        expertise: ["AI tools", "developer productivity"],
        expertiseEmbedding: HIGH_SIM_VEC,
      },
    });

    // Author "low-match" has expertise that won't match query
    await db.insert(articles).values({
      projectId,
      slug: "low-match-author",
      title: "Low Match Author",
      collection: "authors",
      locale: "de",
      domainExtras: {
        expertise: ["cooking", "travel"],
        expertiseEmbedding: LOW_SIM_VEC,
      },
    });

    // Author "no-embedding" has no cached embedding → voyage.embed called to compute it
    await db.insert(articles).values({
      projectId,
      slug: "no-embedding-author",
      title: "No Embedding Author",
      collection: "authors",
      locale: "de",
      domainExtras: {
        expertise: ["machine learning", "neural networks"],
        // No expertiseEmbedding — will trigger embed call
      },
    });

    // Mock voyage.embed: return QUERY_VEC for query, HIGH_SIM_VEC for expertise text
    embedCallCount = 0;
    voyage.embed = mock(async (_text: string) => {
      embedCallCount++;
      return HIGH_SIM_VEC;
    });
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns best match above threshold (high-match author)", async () => {
    const { embeddingAuthorMatch } = await import(
      "../../../src/article/author-picker/embedding.ts"
    );

    const brief = {
      id: crypto.randomUUID(),
      projectId,
      topicTitle: "AI developer tools",
      primaryKeyword: "cursor ai",
      secondaryKeywords: ["copilot", "windsurf"],
      locale: "de",
      intentType: "review",
      source: "trend_discovery",
      clusterId: null,
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
    releaseMetadata: null,
    starTrendMetadata: null,
      routedArticleId: null,
      routedCornerstoneSpecId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await embeddingAuthorMatch(projectId, brief as any, "de");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0.55);
  });

  it("caches expertise embedding on first compute (no-embedding author)", async () => {
    // After the first test, no-embedding-author should now have an embedding cached in DB
    const rows = await db
      .select({ domainExtras: articles.domainExtras })
      .from(articles)
      .where(eq(articles.slug, "no-embedding-author"));

    const extras = (rows[0]?.domainExtras ?? {}) as Record<string, unknown>;
    // The embed mock was called and the result should be cached
    expect(Array.isArray(extras.expertiseEmbedding)).toBe(true);
  });
});
