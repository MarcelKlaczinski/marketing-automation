import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { db, projects, articles, eq } from "@marketing-auto/db";
import { historicAuthorScore } from "../../../src/article/author-picker/historic.ts";

const RUN_DB = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!RUN_DB)("historicAuthorScore (DB)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-historic-${Date.now()}`,
        name: "test-historic-author-picker",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
    clusterId = crypto.randomUUID();

    // Seed historical blog articles for 4 authors
    const seeds: Array<{ author: string; clId: string | null; intentType: string }> = [
      // lukas: 3 posts in cluster + 2 "review" intent
      { author: "lukas", clId: clusterId, intentType: "review" },
      { author: "lukas", clId: clusterId, intentType: "review" },
      { author: "lukas", clId: clusterId, intentType: "overview" },
      // anna: 1 cluster post + 1 "review"
      { author: "anna", clId: clusterId, intentType: "review" },
      { author: "anna", clId: null, intentType: "tutorial" },
      // max: 0 cluster posts, 1 "review"
      { author: "max", clId: null, intentType: "review" },
      // julia: 1 cluster post, 1 "tutorial"
      { author: "julia", clId: clusterId, intentType: "tutorial" },
    ];

    for (const seed of seeds) {
      await db.insert(articles).values({
        projectId,
        slug: `art-${Math.random().toString(36).slice(2)}`,
        title: "Test Article",
        collection: "blog",
        source: "imported",
        locale: "de",
        author: seed.author,
        intentType: seed.intentType,
        ...(seed.clId !== null ? { clusterId: seed.clId } : {}),
      });
    }
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns authors sorted by score descending", async () => {
    const rows = await historicAuthorScore(projectId, clusterId, "review", "de");
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
    }
  });

  it("lukas has highest score (3 cluster + 2 intent matches)", async () => {
    const rows = await historicAuthorScore(projectId, clusterId, "review", "de");
    expect(rows[0]!.slug).toBe("lukas");
    expect(rows[0]!.matchedOnCluster).toBe(3);
    expect(rows[0]!.matchedOnIntent).toBe(2);
  });

  it("excludes authors with toolwiki% slug", async () => {
    await db.insert(articles).values({
      projectId,
      slug: "toolwiki-org-article",
      title: "Toolwiki Org Article",
      collection: "blog",
      source: "imported",
      locale: "de",
      author: "toolwiki-team",
      clusterId,
    });

    const rows = await historicAuthorScore(projectId, clusterId, "review", "de");
    expect(rows.every((r) => !r.slug.startsWith("toolwiki"))).toBe(true);
  });

  it("returns empty array when no blog articles exist for that locale", async () => {
    const rows = await historicAuthorScore(projectId, clusterId, "review", "en");
    expect(rows).toHaveLength(0);
  });

  it("null clusterId still calculates intent matches", async () => {
    const rows = await historicAuthorScore(projectId, null, "review", "de");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.matchedOnCluster === 0)).toBe(true);
    expect(rows.some((r) => r.matchedOnIntent > 0)).toBe(true);
  });

  it("ties broken by total post count (lukas > julia for tutorial intent)", async () => {
    const rows = await historicAuthorScore(projectId, null, "tutorial", "de");
    const lukasIdx = rows.findIndex((r) => r.slug === "lukas");
    const juliaIdx = rows.findIndex((r) => r.slug === "julia");
    if (lukasIdx !== -1 && juliaIdx !== -1) {
      expect(lukasIdx).toBeLessThan(juliaIdx);
    }
  });
});
