/**
 * Live integration test for the full Article Pipeline (Job 1 + Job 2).
 *
 * Gated by RUN_LIVE_ARTICLE_PIPELINE=1 — costs ~€1.30 per run.
 * Calls real APIs: DataForSEO (SERP), Anthropic (outline, draft, review), Replicate (image).
 *
 * Run with:
 *   RUN_LIVE_ARTICLE_PIPELINE=1 bun --filter @marketing-auto/pipelines test article
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, clusters, articles, contentPillars, costLogs } from "@marketing-auto/db";
import { runPipeline } from "../../src/engine/runner.ts";
import { ArticleOutlinePipeline, ArticleDraftPipeline } from "../../src/article/pipeline.ts";
import { _resetProjectContextCache } from "../../src/skills/loader.ts";

const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";

const MARKETING_CONTEXT = `---
slug: ki-wissensraum-test
name: KI-Wissensraum Test
---

# KI-Wissensraum

Voice: Friendly expert. Writes in clear German for AI-curious beginners and intermediate readers.
Audience: German-speaking readers (25-45) exploring practical AI tools.
Pillars: AI Tools, AI Workflows, AI News.
Quality floor: At least 1 concrete example per section. No fluff. No clickbait titles.
`.trim();

describe.skipIf(!LIVE)("Article Pipeline — full integration (Job 1 + Job 2)", () => {
  let projectId: string;
  let clusterId: string;
  let articleId: string;
  let projectSlug: string;

  beforeAll(async () => {
    _resetProjectContextCache();

    projectSlug = `ki-wissensraum-inttest-${Date.now()}`;
    const [p] = await db.insert(projects).values({
      slug: projectSlug,
      name: "KI-Wissensraum Integration Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      marketingContextMd: MARKETING_CONTEXT,
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
      name: "KI-Schreibtools",
      pillar: "AI Tools",
      cornerstoneKeywords: ["ki-schreibtools"],
      satelliteKeywords: [
        {
          cornerstoneKeyword: "ki-schreibtools",
          keywords: [
            { keyword: "chatgpt deutsch schreiben" },
            { keyword: "ki text generator kostenlos" },
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

  it("Job 1: outline pipeline runs to completion and persists outline", async () => {
    const result = await runPipeline(
      new ArticleOutlinePipeline(),
      { articleId, projectId },
      { projectId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Job 1 failed at ${result.failedAtStep}: ${result.error}`);

    expect(result.output.nextAction).toBe("wait_for_review");

    const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    expect(saved!.status).toBe("outline_review");
    expect(saved!.outline).toBeTruthy();
    expect(saved!.title).toBeTruthy();
    expect(saved!.slug).toBeTruthy();
    expect(saved!.metaDescription).toBeTruthy();
    expect(saved!.outlinePipelineRunId).toBeTruthy();
    // Outline must have at least 4 sections (non-null: just written by PersistOutlineStep)
    expect(saved!.outline!.sections.length).toBeGreaterThanOrEqual(4);
  }, 5 * 60 * 1000); // 5 min timeout — DataForSEO + Anthropic

  it("Job 2: draft pipeline runs to completion and persists full article", async () => {
    const result = await runPipeline(
      new ArticleDraftPipeline(),
      { articleId, projectId },
      { projectId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Job 2 failed at ${result.failedAtStep}: ${result.error}`);

    const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    // afterComplete auto-enqueues schema extension, which transitions to schema_extending.
    // Both statuses are valid here depending on whether the enqueue succeeded.
    expect(["final_review", "schema_extending"]).toContain(saved!.status);
    expect(saved!.bodyMd).toBeTruthy();
    expect(saved!.wordCount).toBeGreaterThan(500);
    expect(saved!.selfReviewScore).toBeGreaterThanOrEqual(0);
    expect(saved!.selfReviewIssues).toBeTruthy();
    expect(saved!.heroImagePublicUrl).toBeTruthy();
    expect(saved!.heroImageR2Key).toBeTruthy();
    expect(saved!.heroImageAltText).toBeTruthy();
    expect(saved!.schemaJsonLd).toBeTruthy();
    expect(saved!.draftPipelineRunId).toBeTruthy();
  }, 10 * 60 * 1000); // 10 min timeout — draft + image + review

  it("hero image URL is accessible (HTTP 200)", async () => {
    const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    if (!saved!.heroImagePublicUrl) throw new Error("No hero image URL set");

    const res = await fetch(saved!.heroImagePublicUrl, { method: "HEAD" });
    expect(res.ok).toBe(true);
  });

  it("cost_logs contain entries for the pipeline runs", async () => {
    const logs = await db.select()
      .from(costLogs)
      .where(eq(costLogs.projectId, projectId));

    // Expect at least: DataForSEO SERP, Anthropic synthesis, Anthropic outline, Anthropic draft, Haiku review, Replicate image
    expect(logs.length).toBeGreaterThanOrEqual(3);

    const services = new Set(logs.map((l) => l.service));
    expect(services.has("anthropic")).toBe(true);
  });
});
