import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { db, projects, articles, topicBriefs, eq } from "@marketing-auto/db";
import { enqueueBlogGeneration } from "../../../src/article/blog/trigger.ts";
import type { TopicBrief } from "@marketing-auto/db";

// DB tests require a live database.
const RUN_DB = process.env.RUN_DB_TESTS === "1";

function makeBrief(overrides: Partial<TopicBrief> & { projectId: string }): Omit<TopicBrief, "id" | "createdAt" | "updatedAt"> {
  const { projectId, clusterId, ...rest } = overrides;
  return {
    projectId,
    source: "trend_discovery",
    topicTitle: "Die besten KI-Tools 2026",
    primaryKeyword: "ki tools 2026",
    secondaryKeywords: ["chatgpt", "claude", "midjourney"],
    locale: "de",
    intentType: "review",
    clusterId: clusterId ?? null,
    clusterAction: "append_to_existing",
    approvalRequired: false,
    approvalStatus: "approved",
    gapId: null,
    searchVolumeDe: 12000,
    searchVolumeEn: null,
    difficulty: 40,
    serpSnapshot: null,
    suggestedTitle: "Die besten KI-Tools 2026: Unser ausführlicher Vergleich",
    suggestedSlug: "beste-ki-tools-2026",
    suggestedMeta: "Welche KI-Tools lohnen sich 2026? Wir testen ChatGPT, Claude und mehr.",
    heroImagePrompt: null,
    generationMode: "timely",
    approvedBy: null,
    approvedAt: null,
    gapMetadata: null,
    trendMetadata: {
      trendScore: 82,
      freshnessWindow: "rising",
      relatedEvent: "GPT-5 launch",
      signals: [
        { id: crypto.randomUUID(), source: "producthunt", externalId: "ph-1", capturedAt: new Date().toISOString() },
        { id: crypto.randomUUID(), source: "hackernews", externalId: "hn-1", capturedAt: new Date().toISOString() },
      ],
    },
    refreshMetadata: null,
    comparisonMetadata: null,
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
    routedViaPlanItemId: null,
    ...rest,
  };
}

describe.skipIf(!RUN_DB)("enqueueBlogGeneration (DB fixture)", () => {
  let projectId: string;
  let briefId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-blog-pipeline-${Date.now()}`,
        name: "test-blog-pipeline",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    const [brief] = await db
      .insert(topicBriefs)
      .values({
        ...makeBrief({ projectId }),
      })
      .returning({ id: topicBriefs.id });
    briefId = brief!.id;
  });

  afterAll(async () => {
    // Delete in dependency order: articles → topicBriefs → projects
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("creates article from brief and enqueues blog pipeline", async () => {
    const result = await enqueueBlogGeneration({
      briefId,
      projectId,
      approvalMode: "manual",
    });

    expect(result.status).toBe("blog_generation_enqueued");
    expect(result.articleId).toBeString();
    expect(result.jobId).toBeString();

    // Article row should exist with correct fields
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, result.articleId))
      .limit(1);

    expect(article).toBeDefined();
    expect(article!.projectId).toBe(projectId);
    expect(article!.status).toBe("generating");
    expect(article!.collection).toBe("blog");
    expect(article!.source).toBe("generated");
    expect(article!.locale).toBe("de");
    expect(article!.intentType).toBe("review");
  });

  it("links routedArticleId on the brief after first enqueue", async () => {
    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId))
      .limit(1);

    expect(brief!.routedArticleId).toBeString();
  });

  it("reuses existing article on second enqueue (idempotent article creation)", async () => {
    const result1 = await enqueueBlogGeneration({ briefId, projectId });
    const result2 = await enqueueBlogGeneration({ briefId, projectId });

    // Same article ID both times (brief.routedArticleId already set)
    expect(result1.articleId).toBe(result2.articleId);
  });

  it("throws when brief not found", async () => {
    await expect(
      enqueueBlogGeneration({ briefId: crypto.randomUUID(), projectId }),
    ).rejects.toThrow("not found");
  });

  it("throws when brief belongs to different project", async () => {
    await expect(
      enqueueBlogGeneration({ briefId, projectId: crypto.randomUUID() }),
    ).rejects.toThrow("does not belong");
  });
});

// ─── Pure unit tests (no DB) ─────────────────────────────────────────────────

describe("BlogPipeline — step name constants", () => {
  it("BlogPipeline declares correct pipeline name", async () => {
    const { BlogPipeline } = await import("../../../src/article/blog/pipeline.ts");
    const pipeline = new BlogPipeline();
    expect(pipeline.name).toBe("article:blog");
  });

  it("BlogPipeline has expected step count", async () => {
    const { BlogPipeline } = await import("../../../src/article/blog/pipeline.ts");
    const pipeline = new BlogPipeline();
    expect(pipeline.steps.length).toBe(14);
  });

  it("BlogPipeline steps are in expected order", async () => {
    const { BlogPipeline } = await import("../../../src/article/blog/pipeline.ts");
    const pipeline = new BlogPipeline();
    const stepNames = pipeline.steps.map((s) => s.name);
    expect(stepNames[0]).toBe("author-pick");
    expect(stepNames[1]).toBe("tool-relevance");
    expect(stepNames[2]).toBe("topic-intake");
    // tool-linker should come after draft (persist-body)
    const toolLinkerIdx = stepNames.indexOf("tool-linker");
    const draftIdx = stepNames.indexOf("draft");
    const selfReviewIdx = stepNames.indexOf("self-review");
    expect(toolLinkerIdx).toBeGreaterThan(draftIdx);
    expect(toolLinkerIdx).toBeLessThan(selfReviewIdx);
  });
});

describe("AuthorPickStep", () => {
  it("has correct step name", async () => {
    const { AuthorPickStep } = await import("../../../src/article/author-picker/step.ts");
    expect(new AuthorPickStep().name).toBe("author-pick");
  });
});

describe("ToolRelevanceStep", () => {
  it("has correct step name", async () => {
    const { ToolRelevanceStep } = await import("../../../src/article/tool-linker/resolve-step.ts");
    expect(new ToolRelevanceStep().name).toBe("tool-relevance");
  });

  it("estimatedCostEur is 0", async () => {
    const { ToolRelevanceStep } = await import("../../../src/article/tool-linker/resolve-step.ts");
    expect(new ToolRelevanceStep().estimatedCostEur()).toBe(0);
  });
});
