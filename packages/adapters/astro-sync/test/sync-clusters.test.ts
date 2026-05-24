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
import {
  SyncClustersFromFrontmatterStep,
  canonicalizePillarName,
} from "../src/import/steps/sync-clusters-from-frontmatter.ts";

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
    // `uncategorizedCount` is the count of `source='imported'` articles with
    // `clusterKey IS NULL` EXCLUDING the collections in
    // `EXCLUDED_FROM_CLUSTERING` (usecases / authors / tool-categories /
    // special-landings — entity-style collections that are by-design
    // unclustered per audit/USECASES_DECISION.md).
    //
    // Insert one article in an included collection (`tools`) + one in an
    // excluded collection (`authors`) — the count must reflect 1, NOT 2.
    // This guard also catches accidental additions to / removals from
    // EXCLUDED_FROM_CLUSTERING by making the exclusion path explicit.
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

    expect(result.uncategorizedCount).toBe(1);
    expect(result.clustersCreated).toBe(0);
    expect(result.articlesLinked).toBe(0);
  });
});

// ─── Spec 002 follow-up — pillar-name canonicalization ──────────────────────

describe("canonicalizePillarName (Spec 002 follow-up)", () => {
  test("maps known DE display-labels to EN-canonical slugs", () => {
    expect(canonicalizePillarName("Vergleiche")).toBe("comparisons");
    expect(canonicalizePillarName("Ethik & Recht")).toBe("ethics-law");
    expect(canonicalizePillarName("Grundlagen")).toBe("fundamentals");
    expect(canonicalizePillarName("Zukunft")).toBe("future");
    expect(canonicalizePillarName("Guides & Tutorials")).toBe("guides-tutorials");
    expect(canonicalizePillarName("Technik")).toBe("technology");
    expect(canonicalizePillarName("Tool-Reviews")).toBe("tool-reviews");
    expect(canonicalizePillarName("Praxis")).toBe("practice");
    expect(canonicalizePillarName("Praxis & Use Cases")).toBe("practice-use-cases");
  });

  test("passes canonical EN slugs through unchanged", () => {
    expect(canonicalizePillarName("comparisons")).toBe("comparisons");
    expect(canonicalizePillarName("ethics-law")).toBe("ethics-law");
    expect(canonicalizePillarName("fundamentals")).toBe("fundamentals");
    expect(canonicalizePillarName("practice")).toBe("practice");
    expect(canonicalizePillarName("practice-use-cases")).toBe("practice-use-cases");
  });

  test("passes unknown values through unchanged (no over-eager normalization)", () => {
    expect(canonicalizePillarName("audio-music")).toBe("audio-music"); // tool-scope canonical
    expect(canonicalizePillarName("business-productivity")).toBe("business-productivity");
    expect(canonicalizePillarName("usecases")).toBe("usecases"); // our new internal pillar
    expect(canonicalizePillarName("Uncategorized")).toBe("Uncategorized"); // fallback
    expect(canonicalizePillarName("rag-context-engineering-2026")).toBe("rag-context-engineering-2026"); // ki-wissen custom
  });
});

describe("SyncClustersFromFrontmatterStep — canonicalization integration (Spec 002 follow-up)", () => {
  let projectId: string;

  beforeEach(async () => {
    const slug = `canon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Canonicalization Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = inserted[0]!.id;
  });

  afterEach(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("MDX with categorySlug='Vergleiche' creates 'comparisons' pillar, not 'Vergleiche'", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "test-vergleiche-article",
        cornerstoneKeyword: "test-vergleiche-article",
        title: "Test DE Vergleichs-Artikel",
        clusterKey: "test-cluster-2026",
        category: "Vergleiche", // ← DE display-label form (legacy MDX drift)
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "en",
        slug: "test-comparisons-article",
        cornerstoneKeyword: "test-comparisons-article",
        title: "Test EN Comparison Article",
        clusterKey: "test-cluster-2026",
        category: "comparisons", // ← canonical form (correct)
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    const result = await step.execute({ projectId }, stubCtx);

    const pillars = await db
      .select({ name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    const pillarNames = pillars.map((p) => p.name).sort();

    // Only ONE pillar `comparisons` (NOT both `Vergleiche` AND `comparisons`),
    // plus the auto-created `Uncategorized` fallback.
    expect(pillarNames).toContain("comparisons");
    expect(pillarNames).not.toContain("Vergleiche");
    expect(pillarNames).toContain("Uncategorized");
    expect(pillarNames.length).toBe(2); // exactly comparisons + Uncategorized

    // The single cluster row should reference the canonical pillar AND have
    // canonical `pillar` text field (denormalized).
    const [cluster] = await db
      .select({ pillar: clusters.pillar })
      .from(clusters)
      .where(eq(clusters.projectId, projectId));
    expect(cluster?.pillar).toBe("comparisons"); // NOT "Vergleiche"

    expect(result.pillarsCreated).toBeGreaterThanOrEqual(1);
    expect(result.clustersCreated).toBe(1);
  });

  test("MDX with multiple DE display-labels collapses to single canonical pillars", async () => {
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "art-grundlagen-de",
        cornerstoneKeyword: "art-grundlagen-de",
        title: "Grundlagen-Artikel",
        clusterKey: "grundlagen-cluster-2026",
        category: "Grundlagen",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "en",
        slug: "art-fundamentals-en",
        cornerstoneKeyword: "art-fundamentals-en",
        title: "Fundamentals article",
        clusterKey: "fundamentals-cluster-2026",
        category: "fundamentals",
        status: "published",
      },
      {
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: "art-praxis-de",
        cornerstoneKeyword: "art-praxis-de",
        title: "Praxis-Artikel",
        clusterKey: "praxis-cluster-2026",
        category: "Praxis & Use Cases", // multi-word DE label
        status: "published",
      },
    ]);

    const step = new SyncClustersFromFrontmatterStep();
    await step.execute({ projectId }, stubCtx);

    const pillars = await db
      .select({ name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    const pillarNames = pillars.map((p) => p.name).sort();

    expect(pillarNames).toContain("fundamentals");
    expect(pillarNames).toContain("practice-use-cases");
    expect(pillarNames).not.toContain("Grundlagen");
    expect(pillarNames).not.toContain("Praxis & Use Cases");
  });
});
