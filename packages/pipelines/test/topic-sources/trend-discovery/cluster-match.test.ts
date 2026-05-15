import { describe, expect, it, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { db, sql } from "@marketing-auto/db";
import { findMatchingCluster } from "../../../src/topic-sources/trend-discovery/cluster-match.ts";
import type { SynthesisTopic } from "../../../src/topic-sources/trend-discovery/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = "00000000-0000-0000-0000-000000000004";
const EMPTY_PROJECT_ID = "00000000-0000-0000-0000-000000000005";

function makeTopic(overrides: Partial<SynthesisTopic> = {}): SynthesisTopic {
  return {
    topic_title: "GPT-5 Funktionen im Test",
    primary_keyword: "gpt-5-funktionen",
    secondary_keywords: ["openai gpt-5", "sprachmodell"],
    intent_type: "review",
    generation_mode: "timely",
    suggested_title: "GPT-5 Funktionen im Test 2026",
    suggested_slug: "gpt-5-funktionen-test",
    suggested_meta: "GPT-5 im ausführlichen Test: Alle Funktionen, Preise und Vergleich mit GPT-4.",
    hero_image_prompt: "A futuristic AI brain with glowing neural connections representing GPT-5, digital art style, dark background with blue and purple gradients",
    related_signal_ids: [crypto.randomUUID()],
    freshness_window: "breaking",
    relevance_score: 88,
    ...overrides,
  };
}

// ─── DB seed ──────────────────────────────────────────────────────────────────

let clusterId: string;
let pillarId: string;

beforeAll(async () => {
  // Empty project (no clusters)
  await db.execute(sql`
    INSERT INTO projects (id, name, slug, industry, pipeline_template)
    VALUES (${EMPTY_PROJECT_ID}, 'Cluster Empty', 'cluster-empty', 'other', 'educational')
    ON CONFLICT (id) DO NOTHING
  `);

  // Project with one cluster
  await db.execute(sql`
    INSERT INTO projects (id, name, slug, industry, pipeline_template)
    VALUES (${PROJECT_ID}, 'Cluster Test', 'cluster-test', 'other', 'educational')
    ON CONFLICT (id) DO NOTHING
  `);

  // Need a content pillar for the cluster FK
  const pillarResult = await db.execute<{ id: string }>(sql`
    INSERT INTO content_pillars (project_id, name)
    VALUES (${PROJECT_ID}, 'AI Tools')
    RETURNING id
  `);
  pillarId = pillarResult[0]!.id;

  const clusterResult = await db.execute<{ id: string }>(sql`
    INSERT INTO clusters (project_id, pillar_id, name, primary_keyword)
    VALUES (${PROJECT_ID}, ${pillarId}, 'LLM-Werkzeuge', 'llm-werkzeuge')
    RETURNING id
  `);
  clusterId = clusterResult[0]!.id;
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM clusters WHERE project_id = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM content_pillars WHERE project_id = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id IN (${PROJECT_ID}, ${EMPTY_PROJECT_ID})`);
});

// ─── Mock helpers ─────────────────────────────────────────────────────────────

let originalEmbed: unknown;

beforeEach(async () => {
  const v = await import("@marketing-auto/adapter-voyage");
  originalEmbed = v.voyage.embed;
});

afterEach(async () => {
  const v = await import("@marketing-auto/adapter-voyage");
  v.voyage.embed = originalEmbed as typeof v.voyage.embed;

  // Clear cluster embedding after each test
  await db.execute(sql`UPDATE clusters SET embedding = NULL WHERE project_id = ${PROJECT_ID}`);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("findMatchingCluster — no clusters", () => {
  it("returns matched=false for a project with no clusters", async () => {
    const voyageMod = await import("@marketing-auto/adapter-voyage");
    voyageMod.voyage.embed = mock(async () => new Array(1024).fill(0.5));

    const result = await findMatchingCluster({
      projectId: EMPTY_PROJECT_ID,
      candidate: makeTopic(),
    });

    expect(result.matched).toBe(false);
  });
});

describe("findMatchingCluster — with cluster embeddings", () => {
  const SAME_EMB = new Array(1024).fill(0.5);
  const ALTERNATING_A = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 1.0 : 0.0));
  const ALTERNATING_B = Array.from({ length: 1024 }, (_, i) => (i % 2 === 1 ? 1.0 : 0.0));

  it("matched=true when candidate and cluster embeddings are identical (sim=1.0 > 0.65)", async () => {
    await db.execute(sql`
      UPDATE clusters
      SET embedding = ${JSON.stringify(SAME_EMB)}::vector
      WHERE id = ${clusterId}
    `);

    const voyageMod = await import("@marketing-auto/adapter-voyage");
    voyageMod.voyage.embed = mock(async () => [...SAME_EMB]);

    const result = await findMatchingCluster({ projectId: PROJECT_ID, candidate: makeTopic() });

    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.clusterId).toBe(clusterId);
      expect(result.similarity).toBeGreaterThan(0.65);
    }
  });

  it("matched=false when candidate is orthogonal to cluster (sim ≈ 0 < 0.65)", async () => {
    await db.execute(sql`
      UPDATE clusters
      SET embedding = ${JSON.stringify(ALTERNATING_A)}::vector
      WHERE id = ${clusterId}
    `);

    const voyageMod = await import("@marketing-auto/adapter-voyage");
    // Candidate is orthogonal (alternating B) → cosine sim = 0
    voyageMod.voyage.embed = mock(async () => [...ALTERNATING_B]);

    const result = await findMatchingCluster({ projectId: PROJECT_ID, candidate: makeTopic() });

    expect(result.matched).toBe(false);
  });

  it("lazy backfill: sets cluster embedding when it was null", async () => {
    // Cluster has no embedding at start (cleared by afterEach)
    const voyageMod = await import("@marketing-auto/adapter-voyage");
    const embeddingToSet = [...SAME_EMB];
    voyageMod.voyage.embed = mock(async () => embeddingToSet);

    await findMatchingCluster({ projectId: PROJECT_ID, candidate: makeTopic() });

    // Check that the cluster now has an embedding
    const rows = await db.execute<{ has_emb: string }>(sql`
      SELECT (embedding IS NOT NULL)::text AS has_emb FROM clusters WHERE id = ${clusterId}
    `);
    expect(rows[0]?.has_emb).toBe("true");
  });

  it("embed failure for candidate → returns matched=false (no crash)", async () => {
    await db.execute(sql`
      UPDATE clusters
      SET embedding = ${JSON.stringify(SAME_EMB)}::vector
      WHERE id = ${clusterId}
    `);

    const voyageMod = await import("@marketing-auto/adapter-voyage");
    voyageMod.voyage.embed = mock(async () => { throw new Error("Voyage down"); });

    const result = await findMatchingCluster({ projectId: PROJECT_ID, candidate: makeTopic() });

    expect(result.matched).toBe(false);
  });

  it("matched=false when no cluster has embedding (all null after backfill failure)", async () => {
    // Cluster has no embedding; backfill fails; similarity query returns 0 rows
    const voyageMod = await import("@marketing-auto/adapter-voyage");
    let callCount = 0;
    voyageMod.voyage.embed = mock(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Backfill Voyage down"); // first call = backfill
      return new Array(1024).fill(0.5); // second call = candidate embed
    });

    const result = await findMatchingCluster({ projectId: PROJECT_ID, candidate: makeTopic() });

    // Cluster still has no embedding → no rows → matched=false
    expect(result.matched).toBe(false);
  });
});
