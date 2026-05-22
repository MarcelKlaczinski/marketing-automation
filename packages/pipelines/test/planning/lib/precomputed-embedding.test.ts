// Spec 64.15 Phase C: `createPlanRunEmbeddingProvider` prefers the precomputed
// `topic_briefs.embedding` column over a fresh Voyage call, AND lazy-backfills
// the column on first read for legacy / manual / comparison briefs.
//
// Two cases:
//   1. Precomputed read — brief.embedding is non-null → provider returns it
//      WITHOUT calling Voyage (the cluster fallback isn't consulted either).
//   2. Lazy-backfill — brief.embedding is null → provider computes via Voyage
//      AND writes the result back to topic_briefs.embedding for future reads.
//
// The Voyage call is stubbed via mock.module so tests stay offline.

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const voyageEmbedMock = mock(async () => new Array(1024).fill(0.42));
mock.module("@marketing-auto/adapter-voyage", () => ({
  voyage: { embed: voyageEmbedMock },
}));

const { db, eq, projects, topicBriefs } = await import("@marketing-auto/db");
const { createPlanRunEmbeddingProvider } = await import(
  "../../../src/planning/lib/diversity-embedding.ts"
);

const projectId = `00000000-0000-0000-0000-${"0000000000bc"}`;

beforeAll(async () => {
  await db.insert(projects).values({
    id: projectId,
    slug: `phase-c-precomputed-${projectId.slice(0, 8)}`,
    name: "Phase C precomputed test",
    industry: "ai_education",
    pipelineTemplate: "educational",
  });
});

afterAll(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

beforeEach(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  voyageEmbedMock.mockClear();
});

describe("createPlanRunEmbeddingProvider precomputed read (Spec 64.15 Phase C)", () => {
  it("returns precomputed embedding without calling Voyage", async () => {
    // Seed brief WITH precomputed embedding.
    const briefId = crypto.randomUUID();
    const precomputed = new Array(1024).fill(0.99);
    await db.insert(topicBriefs).values({
      id: briefId,
      projectId,
      source: "manual",
      topicTitle: "Precomputed brief",
      primaryKeyword: "pre",
      secondaryKeywords: [],
      clusterAction: "standalone",
      approvalRequired: false,
      approvalStatus: "approved",
      embedding: precomputed,
    });

    const [row] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId));

    const provider = createPlanRunEmbeddingProvider({ projectId });
    const result = await provider.getForBrief(row!);

    expect(result).toEqual(precomputed);
    expect(voyageEmbedMock).not.toHaveBeenCalled();
  });
});

describe("createPlanRunEmbeddingProvider lazy-backfill (Spec 64.15 Phase C)", () => {
  it("computes via Voyage + persists result to topic_briefs.embedding on first read", async () => {
    const briefId = crypto.randomUUID();
    await db.insert(topicBriefs).values({
      id: briefId,
      projectId,
      source: "manual",
      topicTitle: "Legacy brief no embedding",
      primaryKeyword: "legacy",
      secondaryKeywords: [],
      clusterAction: "standalone",
      approvalRequired: false,
      approvalStatus: "approved",
      embedding: null,
    });

    const [row] = await db.select().from(topicBriefs).where(eq(topicBriefs.id, briefId));

    const provider = createPlanRunEmbeddingProvider({ projectId });
    const result = await provider.getForBrief(row!);

    // Voyage was called exactly once with the brief's embedding text.
    expect(voyageEmbedMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(1024);

    // Lazy backfill is fire-and-forget. Give it a moment to land.
    await new Promise((r) => setTimeout(r, 100));

    const [updated] = await db
      .select({ embedding: topicBriefs.embedding })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId));
    expect(updated!.embedding).toBeDefined();
    expect(updated!.embedding!.length).toBe(1024);
  });
});
