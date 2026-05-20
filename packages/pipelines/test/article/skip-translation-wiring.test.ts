// Spec 62.0a-followup Issue 1: integration tests verifying that the skip gate
// is wired into BlogPipeline.afterComplete. The pure decision logic is covered
// by skip-auto-translation.test.ts; this file ensures the wiring actually fires.
//
// Strategy: mock @marketing-auto/pipelines/src/article/translation/trigger.ts
// to capture calls to enqueueTranslationPipeline, then call BlogPipeline.afterComplete
// directly with a DB-backed article in each state. Mock is installed at the top of
// the file BEFORE importing BlogPipeline so Bun's module cache picks up the mock
// before pipeline.ts binds its import.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { articles, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

// Capture every call to enqueueTranslationPipeline (the one BlogPipeline.afterComplete uses).
const enqueueCalls: Array<Record<string, unknown>> = [];

await mock.module("../../src/article/translation/trigger.ts", () => ({
  enqueueTranslationPipeline: async (input: Record<string, unknown>) => {
    enqueueCalls.push(input);
    return { jobId: "mock-job-id" };
  },
}));

// Imports AFTER the mock so the binding picks up our stub.
const { BlogPipeline } = await import("../../src/article/blog/pipeline.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("BlogPipeline.afterComplete — skip_auto_translation_until wiring", () => {
  let projectId: string;
  let articleId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `skip-xlate-test-${Date.now()}`,
        name: "skip-xlate-test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        targetLocales: ["de-DE", "en-US"],
        translationAutoTrigger: true,
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  beforeEach(async () => {
    enqueueCalls.length = 0;
    // Fresh article per test so we don't carry over sibling state across tests.
    await db.delete(articles).where(eq(articles.projectId, projectId));
    const [art] = await db
      .insert(articles)
      .values({
        projectId,
        title: "Test article",
        slug: `test-${Date.now()}`,
        status: "published",
        source: "generated",
        locale: "de",
        translationKey: `tk-${Date.now()}`,
        bodyMd: "Test body",
      })
      .returning({ id: articles.id });
    articleId = art!.id;
  });

  async function callAfterComplete() {
    const pipeline = new BlogPipeline();
    await pipeline.afterComplete(
      { articleId, wordCount: 100, selfReviewScore: 80 },
      { articleId, projectId, briefId: crypto.randomUUID() },
      crypto.randomUUID(),
    );
  }

  it("triggers translation when skipAutoTranslationUntil is NULL", async () => {
    await callAfterComplete();
    expect(enqueueCalls.length).toBe(1);
    expect(enqueueCalls[0]).toMatchObject({
      sourceArticleId: articleId,
      projectId,
      mode: "fresh_translation",
    });
  });

  it("does NOT trigger translation when skipAutoTranslationUntil is in the future", async () => {
    await db
      .update(articles)
      .set({ skipAutoTranslationUntil: new Date(Date.now() + 7 * DAY_MS) })
      .where(eq(articles.id, articleId));

    await callAfterComplete();
    expect(enqueueCalls.length).toBe(0);
  });

  it("triggers translation when skipAutoTranslationUntil is in the past (expired)", async () => {
    await db
      .update(articles)
      .set({ skipAutoTranslationUntil: new Date(Date.now() - 1 * DAY_MS) })
      .where(eq(articles.id, articleId));

    await callAfterComplete();
    expect(enqueueCalls.length).toBe(1);
  });

  it("does NOT trigger translation when skipAutoTranslationUntil equals now+1ms (boundary)", async () => {
    // Exact boundary: skipUntil just barely in the future → skip.
    await db
      .update(articles)
      .set({ skipAutoTranslationUntil: new Date(Date.now() + 1000) })
      .where(eq(articles.id, articleId));

    await callAfterComplete();
    expect(enqueueCalls.length).toBe(0);
  });
});
