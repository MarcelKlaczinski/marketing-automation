/**
 * Spec 54.3 — /generate route integration tests.
 *
 * Validates that the /generate route refactor correctly:
 * - Loads the TopicBrief for the gap
 * - Calls decideRoute + executeDecision
 * - Marks the brief as "routed" with a routedArticleId or routedCornerstoneSpecId
 * - The response includes briefId
 *
 * Tested at the DB + routing layer (not HTTP) — the core logic is decideRoute +
 * executeDecision, which are already unit-tested. These tests verify the DB state
 * produced by the full routing chain as called by the route.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  clusters,
  contentGaps,
  contentPillars,
  cornerstoneSpecs,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";
import { decideRoute, executeDecision } from "@marketing-auto/pipelines";

describe("/generate route — brief routing (Spec 54.3)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `generate-route-test-${Date.now()}`,
        name: "Generate Route Test",
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
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(cornerstoneSpecs).where(eq(cornerstoneSpecs.projectId, projectId));
    await db.delete(contentGaps).where(eq(contentGaps.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("routes missing_spoke_type → article_created, brief marked routed with routedArticleId", async () => {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        source: "gap_analysis",
        topicTitle: "How to use KI Tools",
        primaryKeyword: "ki tools anleitung",
        secondaryKeywords: [],
        locale: "de",
        intentType: "how_to",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        suggestedTitle: "KI Tools richtig nutzen",
        suggestedSlug: "ki-tools-richtig-nutzen",
        suggestedMeta: "Lerne wie du KI Tools optimal einsetzt.",
        gapMetadata: { gapType: "missing_spoke_type", priority: 2 },
      })
      .returning();

    const decision = decideRoute(brief!);
    expect(decision.kind).toBe("create_article");

    const result = await db.transaction(async (tx) => executeDecision(decision, brief!, tx));

    expect(result.kind).toBe("article_created");
    expect(result.briefId).toBe(brief!.id);
    if (result.kind !== "article_created") return;

    // Article inserted correctly
    const [savedArticle] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, result.articleId))
      .limit(1);
    expect(savedArticle).toBeTruthy();
    expect(savedArticle!.projectId).toBe(projectId);
    expect(savedArticle!.clusterId).toBe(clusterId);
    expect(savedArticle!.intentType).toBe("how_to");
    expect(savedArticle!.status).toBe("proposed");

    // Brief marked routed with routedArticleId
    const [updatedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);
    expect(updatedBrief!.approvalStatus).toBe("routed");
    expect(updatedBrief!.routedArticleId).toBe(result.articleId);
    expect(updatedBrief!.routedCornerstoneSpecId).toBeNull();
  });

  it("routes missing_hub → cornerstone_spec_created, brief marked routed with routedCornerstoneSpecId", async () => {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        source: "gap_analysis",
        topicTitle: "KI Tools Hub",
        primaryKeyword: "ki tools komplett",
        secondaryKeywords: [],
        locale: "de",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        suggestedTitle: "KI Tools: Der ultimative Guide",
        suggestedSlug: "ki-tools-guide",
        suggestedMeta: "Alles über KI Tools in einem Artikel.",
        gapMetadata: { gapType: "missing_hub", priority: 1 },
      })
      .returning();

    const decision = decideRoute(brief!);
    expect(decision.kind).toBe("create_cornerstone_spec");

    const result = await db.transaction(async (tx) => executeDecision(decision, brief!, tx));

    expect(result.kind).toBe("cornerstone_spec_created");
    expect(result.briefId).toBe(brief!.id);
    if (result.kind !== "cornerstone_spec_created") return;

    // Spec inserted correctly
    const [savedSpec] = await db
      .select()
      .from(cornerstoneSpecs)
      .where(eq(cornerstoneSpecs.id, result.cornerstoneSpecId))
      .limit(1);
    expect(savedSpec).toBeTruthy();
    expect(savedSpec!.projectId).toBe(projectId);
    expect(savedSpec!.clusterId).toBe(clusterId);
    expect(savedSpec!.status).toBe("proposed");

    // Brief marked routed with routedCornerstoneSpecId
    const [updatedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);
    expect(updatedBrief!.approvalStatus).toBe("routed");
    expect(updatedBrief!.routedCornerstoneSpecId).toBe(result.cornerstoneSpecId);
    expect(updatedBrief!.routedArticleId).toBeNull();
  });

  it("non-gap_analysis brief → skip decision, brief marked superseded", async () => {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        clusterId,
        source: "trend_discovery",
        topicTitle: "Trending KI Topic",
        primaryKeyword: "ki trend",
        secondaryKeywords: [],
        locale: "de",
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "pending",
        gapMetadata: null,
      })
      .returning();

    const decision = decideRoute(brief!);
    expect(decision.kind).toBe("skip");

    const result = await db.transaction(async (tx) => executeDecision(decision, brief!, tx));

    expect(result.kind).toBe("skipped");

    const [updatedBrief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief!.id))
      .limit(1);
    expect(updatedBrief!.approvalStatus).toBe("superseded");
  });
});
