/**
 * Chain orchestrator unit tests (Spec 49d).
 *
 * Tests DB state transitions without a live BullMQ queue.
 * enqueuePipeline is mocked so tests are safe to run in CI.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { mock, afterAll, beforeAll, describe, expect, it, beforeEach, afterEach } from "bun:test";

// Mock enqueuePipeline BEFORE importing chain-orchestrator (Bun mock.module hoisting)
mock.module("@marketing-auto/pipelines", () => ({
  enqueuePipeline: async (_opts: unknown) => ({ jobId: `mock-job-${Date.now()}` }),
  slugify: (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

import { articles, contentGaps, db, pipelineChains, projects } from "@marketing-auto/db";
import { and, eq } from "drizzle-orm";

// Dynamic import AFTER mock is registered
const { startChain, advanceChain, failChain, resumeChain, cancelChain } =
  await import("../../src/lib/chain-orchestrator.ts");

describe("chain-orchestrator", () => {
  let projectId: string;
  let articleId: string;
  let gapId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `chain-test-${Date.now()}`,
        name: "Chain Orchestrator Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  beforeEach(async () => {
    const [art] = await db
      .insert(articles)
      .values({
        projectId,
        locale: "de",
        title:  "Test article",
        slug:   `test-${Date.now()}`,
        source: "generated",
        status: "proposed",
        approvalMode: "manual",
        clusterRole: "spoke",
        cornerstoneKeyword: "test-keyword",
        collection: "blog",
      })
      .returning({ id: articles.id });
    articleId = art!.id;

    const [gap] = await db
      .insert(contentGaps)
      .values({
        projectId,
        gapType: "missing_spoke_type",
        status:  "open",
        priority: 2,
      })
      .returning({ id: contentGaps.id });
    gapId = gap!.id;
  });

  afterEach(async () => {
    await db.delete(pipelineChains).where(eq(pipelineChains.projectId, projectId));
    await db.delete(contentGaps).where(eq(contentGaps.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
  });

  it("startChain creates pipeline_chains row with status=running and currentStep=outline", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });
    expect(typeof chainId).toBe("string");

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain).toBeDefined();
    expect(chain!.status).toBe("running");
    expect(chain!.currentStep).toBe("outline");
    expect(chain!.articleId).toBe(articleId);
    expect(chain!.gapId).toBe(gapId);
  });

  it("advanceChain transitions outline → draft", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });
    const fakeRunId = crypto.randomUUID();

    await advanceChain(chainId, "outline", fakeRunId);

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("running");
    expect(chain!.currentStep).toBe("draft");
    expect((chain!.stepRuns as Record<string, string>)["outline"]).toBe(fakeRunId);
  });

  it("advanceChain after schema-en completes the chain when autoPublish=false", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });

    // Manually set siblingArticleId (needed for schema-en step)
    await db
      .update(pipelineChains)
      .set({ siblingArticleId: articleId }) // reuse same article for test simplicity
      .where(eq(pipelineChains.id, chainId));

    // Advance through all steps
    for (const step of ["outline", "draft", "schema-de", "localize"] as const) {
      await advanceChain(chainId, step, crypto.randomUUID());
    }
    await advanceChain(chainId, "schema-en", crypto.randomUUID());

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("completed");
    expect(chain!.completedAt).toBeDefined();
  });

  it("failChain sets status=failed and records failed step", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });

    await failChain(chainId, "draft", "LLM context limit exceeded");

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("failed");
    expect(chain!.failedStep).toBe("draft");
    expect(chain!.errorMessage).toBe("LLM context limit exceeded");
    expect(chain!.failedAt).toBeDefined();
  });

  it("resumeChain picks up at failed step and sets status=running", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });
    await failChain(chainId, "draft", "Network timeout");

    const { resumedStep } = await resumeChain(chainId);
    expect(resumedStep).toBe("draft");

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("running");
    expect(chain!.failedStep).toBeNull();
    expect(chain!.failedAt).toBeNull();
    expect(chain!.errorMessage).toBeNull();
  });

  it("cancelChain sets status=cancelled for running chains", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });

    await cancelChain(chainId);

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("cancelled");
  });

  it("advanceChain skips cancelled chains", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });
    await cancelChain(chainId);

    // Should not throw and should not change status
    await advanceChain(chainId, "outline", crypto.randomUUID());

    const [chain] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.status).toBe("cancelled");
  });

  it("resumeChain throws for non-failed chains", async () => {
    const { chainId } = await startChain({ projectId, gapId, articleId });

    await expect(resumeChain(chainId)).rejects.toThrow("not in a resumable state");
  });

  it("autoPublish=true: chain continues to astro-transfer after schema-en", async () => {
    // Set autoPublish on project
    await db
      .update(projects)
      .set({ autoPublish: true })
      .where(eq(projects.id, projectId));

    const { chainId } = await startChain({ projectId, gapId, articleId });

    // Verify autoPublish flag was picked up
    const [chain] = await db
      .select({ autoPublish: pipelineChains.autoPublish })
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    expect(chain!.autoPublish).toBe(true);

    // Advance to schema-en
    await db
      .update(pipelineChains)
      .set({ siblingArticleId: articleId })
      .where(eq(pipelineChains.id, chainId));

    for (const step of ["outline", "draft", "schema-de", "localize"] as const) {
      await advanceChain(chainId, step, crypto.randomUUID());
    }
    await advanceChain(chainId, "schema-en", crypto.randomUUID());

    const [updated] = await db
      .select()
      .from(pipelineChains)
      .where(eq(pipelineChains.id, chainId))
      .limit(1);

    // Should have moved to astro-transfer, not completed yet
    expect(updated!.status).toBe("running");
    expect(updated!.currentStep).toBe("astro-transfer");

    // Reset autoPublish
    await db
      .update(projects)
      .set({ autoPublish: false })
      .where(eq(projects.id, projectId));
  });
});
