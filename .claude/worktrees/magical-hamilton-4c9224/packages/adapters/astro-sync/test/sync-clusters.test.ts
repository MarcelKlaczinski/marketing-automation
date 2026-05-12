/**
 * Spec 49a — SyncClustersFromFrontmatterStep unit tests
 *
 * Tests the deterministic cluster/pillar materialisation from article frontmatter.
 * Each test creates an isolated project (unique slug) and cleans up afterward.
 *
 * Run:
 *   bun test packages/adapters/astro-sync/test/sync-clusters.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { SyncClustersFromFrontmatterStep } from "../src/import/steps/sync-clusters-from-frontmatter.ts";

// Minimal StepContext stub (no LLM calls, no cost tracking)
const stubCtx = {
  projectId: "",
  pipelineRunId: "00000000-0000-0000-0000-000000000000",
  stepRunId: "00000000-0000-0000-0000-000000000000",
  pipelineName: "test",
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  reportProgress: async () => {},
  getStepOutput: () => undefined,
} as never;

describe("SyncClustersFromFrontmatterStep", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `sync-clusters-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Sync Clusters Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = inserted[0]!.id;
  });

  afterEach(async () => {
    // Delete child records explicitly BEFORE the project to prevent a race with the
    // cluster:link-rebuild background scheduler: if the scheduler picks up the approved
    // cluster IDs and tries to INSERT into pipeline_runs after the project is gone, the
    // project_id FK constraint fires. Deleting clusters first removes them from the
    // scheduler's next tick before the project row disappears.
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("creates pillar and cluster from frontmatter", async () => {
    // Insert cornerstone + spoke for the same clusterKey
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "anyword-test",
        cornerstoneKeyword: "anyword test",
        title: "Anyword Test",
        clusterKey: "ai-writing-2026",
        clusterRole: "hub",
        category: "AI Writing Tools",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "anyword-vs-jasper",
        cornerstoneKeyword: "anyword vs jasper",
        title: "Anyword vs Jasper",
        clusterKey: "ai-writing-2026",
        clusterRole: "spoke",
        category: "AI Writing Tools",
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.pillarsCreated).toBeGreaterThanOrEqual(1); // "AI Writing Tools" + maybe "Uncategorized"
    expect(result.clustersCreated).toBe(1);
    expect(result.articlesLinked).toBe(2);
    expect(result.uncategorizedCount).toBe(0);

    // All articles linked to a cluster
    const linked = await db
      .select({ clusterId: articles.clusterId })
      .from(articles)
      .where(eq(articles.projectId, projectId));
    expect(linked.every((a) => a.clusterId !== null)).toBe(true);

    // Cluster has correct name, primaryKeyword (from cornerstone), pillarArticleId set
    const clusterRows = await db
      .select()
      .from(clusters)
      .where(eq(clusters.projectId, projectId));
    expect(clusterRows).toHaveLength(1);
    const cluster = clusterRows[0]!;
    expect(cluster.name).toBe("ai-writing-2026");
    expect(cluster.primaryKeyword).toBe("anyword test"); // from cornerstone article
    expect(cluster.pillarArticleId).not.toBeNull();
    expect(cluster.status).toBe("approved");

    // Pillar created with correct name
    const pillarRows = await db
      .select({ name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    expect(pillarRows.some((p) => p.name === "AI Writing Tools")).toBe(true);
  });

  test("re-running is idempotent — updates, never duplicates", async () => {
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "idempotency-test",
      cornerstoneKeyword: "cluster x keyword",
      title: "Idempotency Test",
      clusterKey: "cluster-x",
      clusterRole: "hub",
      category: "Topic X",
      status: "published",
    });

    const step = new SyncClustersFromFrontmatterStep();

    // First run — creates
    const run1 = await step.execute({ projectId }, stubCtx);
    expect(run1.clustersCreated).toBe(1);
    expect(run1.clustersUpdated).toBe(0);

    // Second run — updates, no duplicates
    const run2 = await step.execute({ projectId }, stubCtx);
    expect(run2.clustersCreated).toBe(0);
    expect(run2.clustersUpdated).toBe(1);

    // Exactly 1 cluster row in DB
    const allClusters = await db
      .select()
      .from(clusters)
      .where(eq(clusters.projectId, projectId));
    expect(allClusters).toHaveLength(1);

    // Pillar also not duplicated
    const allPillars = await db
      .select()
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    // "Topic X" + "Uncategorized" = 2 max
    const pillarCount = allPillars.length;
    expect(pillarCount).toBeGreaterThanOrEqual(1);
    expect(pillarCount).toBeLessThanOrEqual(2);
    // Run 3 to confirm still no growth
    await step.execute({ projectId }, stubCtx);
    const allPillarsAfter3 = await db
      .select()
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    expect(allPillarsAfter3).toHaveLength(pillarCount);
  });

  test("counts uncategorized articles (no clusterKey)", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: "entity-tool",
        cornerstoneKeyword: "entity-tool",
        title: "Some Tool",
        clusterKey: null,
        category: null,
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "authors",
        locale: "de",
        slug: "author-xyz",
        cornerstoneKeyword: "author-xyz",
        title: "Author XYZ",
        clusterKey: null,
        category: null,
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    expect(result.uncategorizedCount).toBe(2);
    expect(result.clustersCreated).toBe(0);
    expect(result.articlesLinked).toBe(0);
  });
});
