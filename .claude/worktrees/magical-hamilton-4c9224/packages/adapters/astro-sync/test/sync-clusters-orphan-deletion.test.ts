/**
 * Spec 49a.fix — SyncClusters orphan-deletion tests
 *
 * Verifies that cluster rows with no referencing articles are deleted after sync.
 *
 * Run:
 *   bun test packages/adapters/astro-sync/test/sync-clusters-orphan-deletion.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { SyncClustersFromFrontmatterStep } from "../src/import/steps/sync-clusters-from-frontmatter.ts";

const stubCtx = {
  projectId: "",
  pipelineRunId: "00000000-0000-0000-0000-000000000000",
  stepRunId: "00000000-0000-0000-0000-000000000000",
  pipelineName: "test",
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  reportProgress: async () => {},
  getStepOutput: () => undefined,
} as never;

describe("SyncClusters orphan-deletion", () => {
  let projectId: string;
  const slug = `orphan-test-${Date.now()}`;

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Orphan Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;
  });

  afterEach(async () => {
    // Delete in dependency order to avoid FK violations from background jobs
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("deletes orphan cluster rows (no articles reference them)", async () => {
    // Insert article with active clusterKey
    await db.insert(articles).values({
      projectId,
      source: "imported",
      slug: "active-article",
      locale: "de",
      collection: "tools",
      cornerstoneKeyword: "active",
      title: "Active Article",
      clusterKey: "active-cluster-2026",
      clusterRole: "spoke",
      category: "Testing",
      status: "published",
    });

    // Need a pillar for the orphan cluster (pillar_id is NOT NULL)
    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "Testing", description: "test", position: 0 })
      .returning({ id: contentPillars.id });

    // Insert orphan cluster row (no article references it)
    await db.insert(clusters).values({
      projectId,
      pillarId: pillar!.id,
      name: "orphan-cluster-2026",
      pillar: "Testing",
      cornerstoneKeywords: [],
      satelliteKeywords: [],
      status: "approved",
    });

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.orphansDeleted).toBe(1);

    const remaining = await db
      .select()
      .from(clusters)
      .where(eq(clusters.projectId, projectId));

    expect(remaining.length).toBe(1);
    expect(remaining[0]!.name).toBe("active-cluster-2026");
  });

  test("does not delete clusters that still have articles", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        slug: "article-a",
        locale: "de",
        collection: "tools",
        cornerstoneKeyword: "a",
        title: "Article A",
        clusterKey: "cluster-a-2026",
        clusterRole: "spoke",
        category: "Testing",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        slug: "article-b",
        locale: "de",
        collection: "tools",
        cornerstoneKeyword: "b",
        title: "Article B",
        clusterKey: "cluster-b-2026",
        clusterRole: "spoke",
        category: "Testing",
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.orphansDeleted).toBe(0);
    expect(result.clustersCreated).toBe(2);
  });

  test("orphansDeleted is 0 when no clusters exist", async () => {
    await db.insert(articles).values({
      projectId,
      source: "imported",
      slug: "solo-article",
      locale: "de",
      collection: "tools",
      cornerstoneKeyword: "solo",
      title: "Solo Article",
      clusterKey: "solo-cluster-2026",
      clusterRole: "spoke",
      category: "Testing",
      status: "published",
    });

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.orphansDeleted).toBe(0);
    expect(result.clustersCreated).toBe(1);
  });
});
