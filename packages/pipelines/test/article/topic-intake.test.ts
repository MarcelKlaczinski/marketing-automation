import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, clusters, contentPillars, db, eq, projects, topicBriefs } from "@marketing-auto/db";
import { TopicIntakeStep } from "../../src/article/steps/topic-intake.ts";
import { ArticlePipelineError } from "../../src/article/types.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const mockCtx = (projectId: string) => makeMockCtx({ projectId });

describe("TopicIntakeStep", () => {
  let projectId: string;
  let clusterId: string;
  let articleId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `topic-intake-test-${Date.now()}`,
        name: "Topic Intake Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({
        projectId,
        name: "AI Tools",
        position: 0,
      })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "AI Writing Tools",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-schreibtools"],
        satelliteKeywords: [
          {
            cornerstoneKeyword: "ki-schreibtools",
            keywords: [{ keyword: "chatgpt schreiben" }, { keyword: "ki text generator" }],
          },
        ],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;

    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "ki-schreibtools",
        cornerstoneKeyword: "ki-schreibtools",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();
    articleId = a!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns correct output shape for a matched cornerstone", async () => {
    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));

    expect(out.cornerstoneKeyword).toBe("ki-schreibtools");
    expect(out.clusterName).toBe("AI Writing Tools");
    expect(out.clusterPillar).toBe("AI Tools");
    expect(out.satelliteKeywords).toEqual(["chatgpt schreiben", "ki text generator"]);
    expect(out.projectSlug).toMatch(/^topic-intake-test-/);
    expect(out.approvalMode).toBe("manual");
  });

  it("carries approvalMode = auto when article is set to auto", async () => {
    await db.update(articles).set({ approvalMode: "auto" }).where(eq(articles.id, articleId));
    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));
    expect(out.approvalMode).toBe("auto");
    await db.update(articles).set({ approvalMode: "manual" }).where(eq(articles.id, articleId));
  });

  it("returns empty satellite keywords when cornerstone not in cluster", async () => {
    const [a2] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "other-keyword",
        cornerstoneKeyword: "other-keyword",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();

    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId: a2!.id, projectId }, mockCtx(projectId));
    expect(out.satelliteKeywords).toEqual([]);

    await db.delete(articles).where(eq(articles.id, a2!.id));
  });

  it("throws ArticlePipelineError for a non-existent article", async () => {
    const step = new TopicIntakeStep();
    await expect(
      step.execute({ articleId: crypto.randomUUID(), projectId }, mockCtx(projectId))
    ).rejects.toThrow(ArticlePipelineError);
  });

  it("throws ArticlePipelineError when article has no clusterId", async () => {
    const [noCluster] = await db
      .insert(articles)
      .values({
        projectId,
        slug: "no-cluster",
        cornerstoneKeyword: "no-cluster",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();

    const step = new TopicIntakeStep();
    await expect(
      step.execute({ articleId: noCluster!.id, projectId }, mockCtx(projectId))
    ).rejects.toThrow(ArticlePipelineError);

    await db.delete(articles).where(eq(articles.id, noCluster!.id));
  });
});

describe("TopicIntakeStep — brief-sourced keywords (Spec 54.3)", () => {
  let projectId: string;
  let clusterId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `topic-intake-brief-test-${Date.now()}`,
        name: "Topic Intake Brief Test",
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
        satelliteKeywords: [
          {
            cornerstoneKeyword: "ki-tools",
            keywords: [{ keyword: "cluster-keyword-1" }, { keyword: "cluster-keyword-2" }],
          },
        ],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;
  });

  afterAll(async () => {
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(clusters).where(eq(clusters.projectId, projectId));
    await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("uses brief.secondaryKeywords when brief is linked via routedArticleId", async () => {
    const [article] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `brief-sourced-article-${Date.now()}`,
        cornerstoneKeyword: "ki-tools",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();

    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "gap_analysis",
        topicTitle: "KI Tools Guide",
        primaryKeyword: "ki-tools-brief",
        secondaryKeywords: ["brief-secondary-1", "brief-secondary-2", "brief-secondary-3"],
        locale: "de",
        clusterId,
        clusterAction: "append_to_existing",
        approvalRequired: true,
        approvalStatus: "routed",
        routedArticleId: article!.id,
        gapMetadata: { gapType: "cluster_too_small", priority: 2 },
      })
      .returning();

    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId: article!.id, projectId }, mockCtx(projectId));

    // Must come from brief, not cluster
    expect(out.satelliteKeywords).toEqual(["brief-secondary-1", "brief-secondary-2", "brief-secondary-3"]);

    await db.delete(topicBriefs).where(eq(topicBriefs.id, brief!.id));
    await db.delete(articles).where(eq(articles.id, article!.id));
  });

  it("falls back to cluster satelliteKeywords when no brief is linked", async () => {
    const [article] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `legacy-article-${Date.now()}`,
        cornerstoneKeyword: "ki-tools",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();

    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId: article!.id, projectId }, mockCtx(projectId));

    // Must fall back to cluster match
    expect(out.satelliteKeywords).toEqual(["cluster-keyword-1", "cluster-keyword-2"]);

    await db.delete(articles).where(eq(articles.id, article!.id));
  });

  it("returns empty satellite keywords for legacy article with unmatched cornerstoneKeyword", async () => {
    const [article] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: `unmatched-legacy-${Date.now()}`,
        cornerstoneKeyword: "no-match-keyword",
        status: "generating",
        approvalMode: "manual",
      })
      .returning();

    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId: article!.id, projectId }, mockCtx(projectId));

    expect(out.satelliteKeywords).toEqual([]);

    await db.delete(articles).where(eq(articles.id, article!.id));
  });
});
