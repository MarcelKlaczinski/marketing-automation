// Spec 64.15 Phase C: backfill script offline tests.
//
// DI ports keep these tests offline — no Voyage call, no DB writes for the
// dry-run case. The DB-write case uses real Postgres (same as
// cleanup-orphan-heroes tests) so the Drizzle layer + the `embedding` column
// shape get exercised end-to-end.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  backfillBriefEmbeddings,
  type DatabasePort,
  type EmbedderPort,
} from "../../src/scripts/backfill-brief-embeddings.ts";
import {
  db,
  eq,
  projects,
  topicBriefs,
  type TopicBrief,
} from "@marketing-auto/db";

const FAKE_EMBEDDING = new Array(1024).fill(0.1);

// ─── Offline DI test: dry-run does NOT call the embedder ─────────────────────

describe("backfillBriefEmbeddings dry-run (Spec 64.15 Phase C)", () => {
  it("does NOT call the embedder when apply=false", async () => {
    const embedMock = mock(async () => FAKE_EMBEDDING);
    const updateMock = mock(async () => {});
    const briefs: TopicBrief[] = [
      makeFakeBrief("brief-1"),
      makeFakeBrief("brief-2"),
    ];

    const result = await backfillBriefEmbeddings({
      apply: false,
      batchSize: 50,
      embedder: { embed: embedMock },
      database: makeMemoryDatabasePort({ briefs, updateMock }),
    });

    expect(embedMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalScanned: 2,
      totalBackfilled: 2,
      totalSkipped: 0,
      totalFailed: 0,
      dryRun: true,
    });
  });

  it("apply=true calls the embedder once per brief and updates each row", async () => {
    const embedMock = mock(async () => FAKE_EMBEDDING);
    const updateMock = mock(async () => {});
    const briefs: TopicBrief[] = [
      makeFakeBrief("brief-1"),
      makeFakeBrief("brief-2"),
    ];

    const result = await backfillBriefEmbeddings({
      apply: true,
      batchSize: 50,
      embedder: { embed: embedMock },
      database: makeMemoryDatabasePort({ briefs, updateMock }),
    });

    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(result.totalBackfilled).toBe(2);
    expect(result.totalFailed).toBe(0);
    expect(result.dryRun).toBe(false);
  });

  it("skips briefs with no topicTitle or primaryKeyword (untriagable)", async () => {
    const embedMock = mock(async () => FAKE_EMBEDDING);
    const updateMock = mock(async () => {});
    const blank = makeFakeBrief("brief-blank");
    blank.topicTitle = "";
    blank.primaryKeyword = null;
    const briefs: TopicBrief[] = [blank];

    const result = await backfillBriefEmbeddings({
      apply: true,
      batchSize: 50,
      embedder: { embed: embedMock },
      database: makeMemoryDatabasePort({ briefs, updateMock }),
    });

    expect(embedMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(result.totalSkipped).toBe(1);
    expect(result.totalBackfilled).toBe(0);
  });

  it("counts failures separately and does not abort the run", async () => {
    const embedMock = mock(async () => {
      throw new Error("Voyage rate-limited");
    });
    const updateMock = mock(async () => {});
    const briefs: TopicBrief[] = [
      makeFakeBrief("brief-1"),
      makeFakeBrief("brief-2"),
    ];

    const result = await backfillBriefEmbeddings({
      apply: true,
      batchSize: 50,
      embedder: { embed: embedMock },
      database: makeMemoryDatabasePort({ briefs, updateMock }),
    });

    expect(embedMock).toHaveBeenCalledTimes(2);
    // Failure count = both briefs (Voyage throws for each).
    expect(result.totalFailed).toBe(2);
    expect(result.totalBackfilled).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── Online DB test: real Postgres exercises Drizzle vector(1024) path ───────

describe("backfillBriefEmbeddings DB integration (Spec 64.15 Phase C)", () => {
  const projectId = `00000000-0000-0000-0000-${"0000000000ba"}`;

  beforeAll(async () => {
    await db.insert(projects).values({
      id: projectId,
      slug: `phase-c-backfill-${projectId.slice(0, 8)}`,
      name: "Phase C backfill test",
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
  });

  it("apply=true (project-scoped) writes vector(1024) embeddings into the topic_briefs row", async () => {
    // Seed one brief with embedding=NULL.
    const briefId = crypto.randomUUID();
    await db.insert(topicBriefs).values({
      id: briefId,
      projectId,
      source: "manual",
      topicTitle: "Test backfill",
      primaryKeyword: "backfill",
      secondaryKeywords: [],
      clusterAction: "standalone",
      approvalRequired: false,
      approvalStatus: "approved",
    });

    // Use the embedder stub so the test stays offline; the DatabasePort goes
    // through the real Drizzle layer to verify the vector(1024) write path.
    const stubEmbedder: EmbedderPort = {
      embed: async () => FAKE_EMBEDDING,
    };

    // CRITICAL: scope to this test's project. Without --project the backfill
    // iterates ALL projects in the DB and contaminates real tenant data with
    // FAKE_EMBEDDING (caught during /review-task on Spec 64.15 Phase C).
    const [proj] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const result = await backfillBriefEmbeddings({
      projectSlug: proj!.slug,
      apply: true,
      batchSize: 10,
      embedder: stubEmbedder,
    });

    expect(result.totalBackfilled).toBeGreaterThanOrEqual(1);

    // Verify the row now carries an embedding.
    const [row] = await db
      .select({ embedding: topicBriefs.embedding })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId));
    expect(row).toBeDefined();
    expect(row!.embedding).toBeDefined();
    expect(row!.embedding!).toHaveLength(1024);
  });
});

// ─── Fixtures + helpers ──────────────────────────────────────────────────────

function makeFakeBrief(label: string): TopicBrief {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    source: "manual",
    gapId: null,
    topicTitle: `Test ${label}`,
    primaryKeyword: `kw-${label}`,
    secondaryKeywords: [],
    locale: null,
    intentType: null,
    clusterId: null,
    clusterAction: "standalone",
    searchVolumeDe: null,
    searchVolumeEn: null,
    difficulty: null,
    serpSnapshot: null,
    suggestedTitle: null,
    suggestedSlug: null,
    suggestedMeta: null,
    heroImagePrompt: null,
    generationMode: null,
    approvalRequired: false,
    approvalStatus: "approved",
    approvedBy: null,
    approvedAt: null,
    gapMetadata: null,
    trendMetadata: null,
    refreshMetadata: null,
    comparisonMetadata: null,
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
    routedViaPlanItemId: null,
    embedding: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMemoryDatabasePort({
  briefs,
  updateMock,
}: {
  briefs: TopicBrief[];
  updateMock: ReturnType<typeof mock>;
}): DatabasePort {
  // Returns all rows the FIRST time, then [] so the loop terminates.
  let exhausted = false;
  return {
    async resolveProjectIdBySlug() {
      return null; // unused in these offline cases
    },
    async countBriefsWithoutEmbedding() {
      return briefs.length;
    },
    async loadBriefsWithoutEmbedding(_, _limit) {
      if (exhausted) return [];
      exhausted = true;
      return briefs;
    },
    updateBriefEmbedding: updateMock as unknown as DatabasePort["updateBriefEmbedding"],
  };
}
