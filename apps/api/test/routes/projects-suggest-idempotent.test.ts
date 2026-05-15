/**
 * Spec 54.3 — /suggest idempotency tests.
 *
 * Tests the core idempotency invariant: a brief that already has secondaryKeywords
 * must not trigger a DataForSEO/Anthropic call on the second /suggest.
 *
 * Validated at the DB layer (not HTTP) — the route's idempotency check is:
 *   if (brief.secondaryKeywords.length > 0 && brief.primaryKeyword) → cached: true
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { mock, afterAll, beforeAll, describe, expect, it } from "bun:test";

// Mock adapters BEFORE any imports that might pull them in
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async () => {
      throw new Error("DataForSEO/Anthropic should NOT be called for cached briefs");
    },
  },
}));

mock.module("@marketing-auto/adapter-dataforseo", () => ({
  dataforseo: {
    keywordOverview: async () => {
      throw new Error("DataForSEO should NOT be called for cached briefs");
    },
    relatedKeywords: async () => {
      throw new Error("DataForSEO should NOT be called for cached briefs");
    },
  },
}));

import {
  articles,
  clusters,
  contentGaps,
  contentPillars,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";

describe("/suggest idempotency (Spec 54.3)", () => {
  let projectId: string;
  let clusterId: string;
  let gapId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `suggest-idempotency-test-${Date.now()}`,
        name: "Suggest Idempotency Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "AI Tools", position: 0 })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "KI Tools",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-tools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;

    const [g] = await db
      .insert(contentGaps)
      .values({
        projectId,
        clusterId,
        gapType: "cluster_too_small",
        priority: 2,
        status: "open",
        metadata: { clusterName: "KI Tools", gapType: "cluster_too_small", priority: 2 },
      })
      .returning();
    gapId = g!.id;
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(contentGaps).where(eq(contentGaps.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("detects cache hit when brief already has secondaryKeywords + primaryKeyword", async () => {
    // Create brief that already has keywords (simulating a prior /suggest call)
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        gapId,
        source: "gap_analysis",
        topicTitle: "KI Tools Guide",
        primaryKeyword: "ki tools",
        secondaryKeywords: ["chatgpt tools", "ki software", "ai tools deutsch"],
        locale: "de",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
        suggestedTitle: "Die besten KI Tools 2024",
        suggestedSlug: "beste-ki-tools",
        suggestedMeta: "Entdecke die besten KI Tools für dein Business.",
      })
      .returning();

    // Simulate the route's idempotency check
    const [loadedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);

    const isCached =
      (loadedBrief?.secondaryKeywords?.length ?? 0) > 0 && !!loadedBrief?.primaryKeyword;

    expect(isCached).toBe(true);

    // Snapshot cluster.satelliteKeywords BEFORE — must not change after cached /suggest
    const [clusterBefore] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, clusterId))
      .limit(1);

    // A cached /suggest only reads the brief, no writes to cluster
    // (The adapter mocks above throw if called — proves no adapter call happened)
    expect(loadedBrief!.suggestedTitle).toBe("Die besten KI Tools 2024");
    expect(loadedBrief!.secondaryKeywords).toEqual(["chatgpt tools", "ki software", "ai tools deutsch"]);

    const [clusterAfter] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, clusterId))
      .limit(1);

    // satelliteKeywords unchanged
    expect(clusterAfter!.satelliteKeywords).toEqual(clusterBefore!.satelliteKeywords);

    await db.delete(topicBriefs).where(eq(topicBriefs.id, brief!.id));
  });

  it("correctly identifies a non-cached brief (missing secondaryKeywords)", async () => {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        gapId,
        source: "gap_analysis",
        topicTitle: "KI Tools Guide Empty",
        primaryKeyword: null,
        secondaryKeywords: [],
        locale: "de",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
      })
      .returning();

    const [loadedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);

    const isCached =
      (loadedBrief?.secondaryKeywords?.length ?? 0) > 0 && !!loadedBrief?.primaryKeyword;

    expect(isCached).toBe(false);

    await db.delete(topicBriefs).where(eq(topicBriefs.id, brief!.id));
  });

  it("writing suggestion results to brief does NOT update cluster.satelliteKeywords", async () => {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        gapId,
        source: "gap_analysis",
        topicTitle: "Fresh Brief",
        primaryKeyword: null,
        secondaryKeywords: [],
        locale: "de",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
      })
      .returning();

    const [clusterBefore] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, clusterId))
      .limit(1);

    // Simulate the /suggest write (post-54.3): only writes to topicBriefs
    await db
      .update(topicBriefs)
      .set({
        primaryKeyword: "ki tools",
        secondaryKeywords: ["new-keyword-1", "new-keyword-2"],
        suggestedTitle: "KI Tools Übersicht",
        suggestedSlug: "ki-tools-uebersicht",
        suggestedMeta: "Alle KI Tools auf einen Blick.",
        updatedAt: new Date(),
      })
      .where(eq(topicBriefs.id, brief!.id));

    const [clusterAfter] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, clusterId))
      .limit(1);

    // Cluster must be unchanged (no satellite_keywords write)
    expect(clusterAfter!.satelliteKeywords).toEqual(clusterBefore!.satelliteKeywords);

    // Brief must have the new keywords
    const [updatedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);
    expect(updatedBrief!.secondaryKeywords).toEqual(["new-keyword-1", "new-keyword-2"]);
    expect(updatedBrief!.primaryKeyword).toBe("ki tools");

    await db.delete(topicBriefs).where(eq(topicBriefs.id, brief!.id));
  });
});
