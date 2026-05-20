// Spec 62.0a-followup Issue 3 regression test for orphan-substep on batch resume.
//
// Background: Pre-flight Task 1 of Spec 62.0a found that batch-resume re-executes
// a step but does not mark the prior substep row (status='running' or 'batch_pending')
// as superseded, leaving an orphan row in the UI. The fix is the call to
// `supersedeOldSubstep(runId, stepKey)` at the top of `resumePipeline()` in
// packages/pipelines/src/engine/batch-resume.ts.
//
// This test exercises that supersession by:
//   1. Inserting a parent `pipeline_runs` row in status='batch_pending' with a checkpoint
//   2. Inserting a substep row (parent_run_id = parent.id) in status='batch_pending'
//   3. Inserting the matching `batch_requests` row with a response body
//   4. Calling `resumePipeline(batchRow)` and asserting the prior substep is now `superseded`
//
// The post-resume call enqueues a BullMQ job — we mock @marketing-auto/pipelines's
// queue module so no Redis is touched. The DB side-effects we care about (supersede
// + status→queued) happen BEFORE the enqueue call inside resumePipeline().
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { batchRequests, db, eq, pipelineRuns, projects } from "@marketing-auto/db";

const enqueueCalls: Array<unknown> = [];

await mock.module("../../src/engine/queue.ts", () => ({
  enqueuePipeline: async (input: unknown) => {
    enqueueCalls.push(input);
    return { jobId: "mock-job-id" };
  },
}));

const { resumePipeline } = await import("../../src/engine/batch-resume.ts");

describe("resumePipeline supersedes orphan substep (Spec 62.0a-followup Issue 3)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `batch-resume-test-${Date.now()}`,
        name: "batch-resume-test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(batchRequests).where(eq(batchRequests.projectId, projectId));
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("marks the prior 'batch_pending' substep as 'superseded' and re-enqueues with queued status", async () => {
    // 1. Parent pipeline run in batch_pending with a checkpoint.
    const [parent] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:outline",
        stepName: null,
        status: "batch_pending",
        input: { articleId: crypto.randomUUID() },
        suspensionCheckpoint: {
          kind: "batch",
          stepKey: "outline",
          batchRequestId: "placeholder",
          accumulatedOutput: { "earlier-step": { x: 1 } },
        } as Record<string, unknown>,
        startedAt: new Date(),
      })
      .returning({ id: pipelineRuns.id });
    const parentId = parent!.id;

    // 2. Orphan substep that returned batchPending and is still "in flight".
    const [substep] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:outline",
        stepName: "outline",
        status: "batch_pending",
        parentRunId: parentId,
        input: {},
        startedAt: new Date(Date.now() - 60_000),
      })
      .returning({ id: pipelineRuns.id });
    const substepId = substep!.id;

    // 3. Matching batch_requests row carrying the LLM response.
    const [batchRow] = await db
      .insert(batchRequests)
      .values({
        projectId,
        pipelineRunId: parentId,
        anthropicCustomId: `${parentId}_outline`,
        anthropicBatchId: "anthropic-batch-xyz",
        status: "completed",
        model: "claude-sonnet-4-6",
        stepKey: "outline",
        requestBody: {} as Record<string, unknown>,
        responseBody: { content: '{"title":"Test"}' } as Record<string, unknown>,
      })
      .returning();
    expect(batchRow).toBeDefined();

    // 4. Run the resume.
    enqueueCalls.length = 0;
    await resumePipeline(batchRow!);

    // Assertions:
    // The prior substep row must now be `superseded` — no orphan-running row remains.
    const [supersededRow] = await db
      .select({ status: pipelineRuns.status, completedAt: pipelineRuns.completedAt })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, substepId))
      .limit(1);
    expect(supersededRow!.status).toBe("superseded");
    expect(supersededRow!.completedAt).not.toBeNull();

    // The parent run was flipped to `queued` for the re-enqueue and checkpoint cleared.
    const [parentRow] = await db
      .select({ status: pipelineRuns.status, suspensionCheckpoint: pipelineRuns.suspensionCheckpoint })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, parentId))
      .limit(1);
    expect(parentRow!.status).toBe("queued");
    expect(parentRow!.suspensionCheckpoint).toBeNull();

    // The batch_requests row was marked `resume_enqueued`.
    const [updatedBatch] = await db
      .select({ status: batchRequests.status })
      .from(batchRequests)
      .where(eq(batchRequests.id, batchRow!.id))
      .limit(1);
    expect(updatedBatch!.status).toBe("resume_enqueued");

    // And the queue was actually called with the resume payload.
    expect(enqueueCalls.length).toBe(1);
  });

  it("does NOT supersede when no prior substep is in flight (idempotency check)", async () => {
    // Edge case: a resume that fires twice — second call must not silently succeed
    // or cause duplicate behavior. Here we run resume against a parent that has no
    // orphan substep at all (all prior substeps already terminal).
    const [parent] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:outline",
        stepName: null,
        status: "batch_pending",
        input: { articleId: crypto.randomUUID() },
        suspensionCheckpoint: {
          kind: "batch",
          stepKey: "outline",
          batchRequestId: "placeholder-2",
          accumulatedOutput: {},
        } as Record<string, unknown>,
        startedAt: new Date(),
      })
      .returning({ id: pipelineRuns.id });
    const parentId = parent!.id;

    // Substep already in a terminal state (completed) — supersede must skip it.
    const [substep] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:outline",
        stepName: "outline",
        status: "completed",
        parentRunId: parentId,
        input: {},
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
      })
      .returning({ id: pipelineRuns.id });
    const substepId = substep!.id;

    const [batchRow] = await db
      .insert(batchRequests)
      .values({
        projectId,
        pipelineRunId: parentId,
        anthropicCustomId: `${parentId}_outline_2`,
        anthropicBatchId: "anthropic-batch-2",
        status: "completed",
        model: "claude-sonnet-4-6",
        stepKey: "outline",
        requestBody: {} as Record<string, unknown>,
        responseBody: { content: "{}" } as Record<string, unknown>,
      })
      .returning();

    await resumePipeline(batchRow!);

    // The terminal substep stays at status='completed' — supersede must not touch it.
    const [unchanged] = await db
      .select({ status: pipelineRuns.status })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, substepId))
      .limit(1);
    expect(unchanged!.status).toBe("completed");
  });
});
