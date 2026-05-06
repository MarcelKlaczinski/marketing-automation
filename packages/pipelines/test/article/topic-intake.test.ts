import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, clusters, articles, contentPillars } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { TopicIntakeStep } from "../../src/article/steps/topic-intake.ts";
import { ArticlePipelineError } from "../../src/article/types.ts";
import type { StepContext } from "../../src/engine/step.ts";

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

describe("TopicIntakeStep", () => {
  let projectId: string;
  let clusterId: string;
  let articleId: string;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug: `topic-intake-test-${Date.now()}`,
      name: "Topic Intake Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;

    const [pillar] = await db.insert(contentPillars).values({
      projectId,
      name: "AI Tools",
      position: 0,
    }).returning();

    const [c] = await db.insert(clusters).values({
      projectId,
      pillarId: pillar!.id,
      name: "AI Writing Tools",
      pillar: "AI Tools",
      cornerstoneKeywords: ["ki-schreibtools"],
      satelliteKeywords: [
        {
          cornerstoneKeyword: "ki-schreibtools",
          keywords: [
            { keyword: "chatgpt schreiben" },
            { keyword: "ki text generator" },
          ],
        },
      ],
      status: "approved",
    }).returning();
    clusterId = c!.id;

    const [a] = await db.insert(articles).values({
      projectId,
      clusterId,
      slug: "ki-schreibtools",
      cornerstoneKeyword: "ki-schreibtools",
      status: "generating",
      approvalMode: "manual",
    }).returning();
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
    const [a2] = await db.insert(articles).values({
      projectId,
      clusterId,
      slug: "other-keyword",
      cornerstoneKeyword: "other-keyword",
      status: "generating",
      approvalMode: "manual",
    }).returning();

    const step = new TopicIntakeStep();
    const out = await step.execute({ articleId: a2!.id, projectId }, mockCtx(projectId));
    expect(out.satelliteKeywords).toEqual([]);

    await db.delete(articles).where(eq(articles.id, a2!.id));
  });

  it("throws ArticlePipelineError for a non-existent article", async () => {
    const step = new TopicIntakeStep();
    await expect(
      step.execute({ articleId: crypto.randomUUID(), projectId }, mockCtx(projectId)),
    ).rejects.toThrow(ArticlePipelineError);
  });

  it("throws ArticlePipelineError when article has no clusterId", async () => {
    const [noCluster] = await db.insert(articles).values({
      projectId,
      slug: "no-cluster",
      cornerstoneKeyword: "no-cluster",
      status: "generating",
      approvalMode: "manual",
    }).returning();

    const step = new TopicIntakeStep();
    await expect(
      step.execute({ articleId: noCluster!.id, projectId }, mockCtx(projectId)),
    ).rejects.toThrow(ArticlePipelineError);

    await db.delete(articles).where(eq(articles.id, noCluster!.id));
  });
});
