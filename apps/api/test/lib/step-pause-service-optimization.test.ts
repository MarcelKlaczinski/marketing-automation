// Spec 62.0b Scenario 12: extract-for-optimization persists a step_optimization_requests
// row via the service layer. The step_pauses row stays unresolved (62.0a-D8 behavior
// preserved) so the UI keeps showing the pause as active.
//
// Run: bun --filter @marketing-auto/api test test/lib/step-pause-service-optimization.test.ts

import { mock, afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

// Mock enqueuePipeline (the service does not call it for extract-for-optimization,
// but the import chain pulls in BullMQ which we don't want to hit).
mock.module("@marketing-auto/pipelines", () => ({
  enqueuePipeline: async (_opts: unknown) => ({ jobId: `mock-job-${Date.now()}` }),
}));

import {
  and,
  db,
  eq,
  listOptimizationRequestsForProject,
  pipelineRuns,
  projects,
  stepPauses,
  stepOptimizationRequests,
} from "@marketing-auto/db";

const { resolveStepPause } = await import("../../src/lib/step-pause-service.ts");

describe("step-pause-service: extract-for-optimization", () => {
  let projectId: string;
  let parentRunId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `opt-svc-${Date.now()}`,
        name: "Optimization Service Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project insert failed");
    projectId = proj.id;

    const [run] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "test:pipeline",
        stepName: null,
        status: "paused",
        input: {},
      })
      .returning();
    if (!run) throw new Error("pipeline_run insert failed");
    parentRunId = run.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  afterEach(async () => {
    // Each test inserts its own step_pause + sub-run; clean both.
    await db
      .delete(stepOptimizationRequests)
      .where(eq(stepOptimizationRequests.projectId, projectId));
    await db.delete(stepPauses).where(eq(stepPauses.projectId, projectId));
    await db
      .delete(pipelineRuns)
      .where(
        and(eq(pipelineRuns.projectId, projectId), eq(pipelineRuns.parentRunId, parentRunId))
      );
  });

  async function insertPause(stepName: string) {
    const [subRun] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "test:pipeline",
        stepName,
        parentRunId,
        status: "paused",
        input: {},
      })
      .returning();
    if (!subRun) throw new Error("sub-run insert failed");

    const [pause] = await db
      .insert(stepPauses)
      .values({
        pipelineRunId: parentRunId,
        stepRunId: subRun.id,
        stepName,
        pipelineName: "test:pipeline",
        projectId,
        stepInput: { keyword: "hyper-realistic-images" },
        stepOutput: { headline: "Top 5 ways to draw better stick figures" },
        promptUsed: "you are a copywriter who writes headlines",
      })
      .returning();
    if (!pause) throw new Error("step_pause insert failed");
    return pause;
  }

  it("creates a step_optimization_requests row with frozen snapshot fields", async () => {
    const pause = await insertPause("step-headline");
    const result = await resolveStepPause(
      pause.id,
      { action: "extract-for-optimization", userNote: "headline too generic" },
      "tester@example.com"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reEnqueued).toBe(false);

    // Pause row updated but resolved_at stays NULL (62.0a-D8 behavior).
    const [updatedPause] = await db
      .select()
      .from(stepPauses)
      .where(eq(stepPauses.id, pause.id))
      .limit(1);
    expect(updatedPause?.action).toBe("extract-for-optimization");
    expect(updatedPause?.userNote).toBe("headline too generic");
    expect(updatedPause?.resolvedAt).toBeNull();

    // step_optimization_requests row created with frozen snapshot.
    const requests = await listOptimizationRequestsForProject({ projectId });
    expect(requests.length).toBe(1);
    const req = requests[0]!;
    expect(req.stepPauseId).toBe(pause.id);
    expect(req.stepName).toBe("step-headline");
    expect(req.pipelineName).toBe("test:pipeline");
    expect(req.userNote).toBe("headline too generic");
    expect(req.requestedBy).toBe("tester@example.com");
    expect(req.status).toBe("open");
    expect(req.stepInput).toEqual({ keyword: "hyper-realistic-images" });
    expect(req.stepOutput).toEqual({ headline: "Top 5 ways to draw better stick figures" });
    expect(req.promptUsed).toBe("you are a copywriter who writes headlines");
  });

  it("rejects a second extract on an already-resolved pause with 409", async () => {
    const pause = await insertPause("step-headline-2");
    // Manually mark as resolved.
    await db
      .update(stepPauses)
      .set({ resolvedAt: new Date(), resolvedBy: "test" })
      .where(eq(stepPauses.id, pause.id));

    const result = await resolveStepPause(
      pause.id,
      { action: "extract-for-optimization", userNote: "second attempt" },
      "tester@example.com"
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe("already_resolved");

    // No optimization request row was created.
    const requests = await listOptimizationRequestsForProject({ projectId });
    expect(requests.length).toBe(0);
  });
});
