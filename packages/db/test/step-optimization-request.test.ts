// Spec 62.0b unit tests for step_optimization_requests read/write helpers.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createOptimizationRequest,
  db,
  eq,
  getOptimizationRequestById,
  listOptimizationRequestsForProject,
  pipelineRuns,
  projects,
  stepPauses,
  updateOptimizationRequestStatus,
} from "../src/index.ts";

describe("step-optimization-request helpers", () => {
  let projectId: string;
  let pauseAId: string;
  let pauseBId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [p] = await db
      .insert(projects)
      .values({
        slug: `opt-req-${ts}`,
        name: "Optimization Request Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;

    // Need a pipeline_run + two step_pauses (FKs from step_optimization_requests).
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

    const [subRunA] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "test:pipeline",
        stepName: "step-a",
        parentRunId: run.id,
        status: "paused",
        input: {},
      })
      .returning();
    const [subRunB] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "test:pipeline",
        stepName: "step-b",
        parentRunId: run.id,
        status: "paused",
        input: {},
      })
      .returning();
    if (!subRunA || !subRunB) throw new Error("sub-run insert failed");

    const [pa] = await db
      .insert(stepPauses)
      .values({
        pipelineRunId: run.id,
        stepRunId: subRunA.id,
        stepName: "step-a",
        pipelineName: "test:pipeline",
        projectId,
        stepInput: { foo: "bar-a" },
        stepOutput: { result: "out-a" },
        promptUsed: null,
      })
      .returning();
    const [pb] = await db
      .insert(stepPauses)
      .values({
        pipelineRunId: run.id,
        stepRunId: subRunB.id,
        stepName: "step-b",
        pipelineName: "test:pipeline",
        projectId,
        stepInput: { foo: "bar-b" },
        stepOutput: { result: "out-b" },
        promptUsed: "the-prompt-used",
      })
      .returning();
    if (!pa || !pb) throw new Error("step_pauses insert failed");
    pauseAId = pa.id;
    pauseBId = pb.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("creates an optimization request with frozen snapshot fields", async () => {
    const row = await createOptimizationRequest({
      stepPauseId: pauseAId,
      stepName: "step-a",
      pipelineName: "test:pipeline",
      projectId,
      stepInput: { foo: "bar-a" },
      stepOutput: { result: "out-a" },
      promptUsed: null,
      userNote: "output too generic",
      requestedBy: "tester",
    });

    expect(row.id).toBeDefined();
    expect(row.status).toBe("open");
    expect(row.userNote).toBe("output too generic");
    expect(row.stepOutput).toEqual({ result: "out-a" });

    const fetched = await getOptimizationRequestById(row.id);
    expect(fetched?.userNote).toBe("output too generic");
  });

  it("lists requests by project, newest first; filters by status", async () => {
    await createOptimizationRequest({
      stepPauseId: pauseBId,
      stepName: "step-b",
      pipelineName: "test:pipeline",
      projectId,
      stepInput: { foo: "bar-b" },
      stepOutput: { result: "out-b" },
      promptUsed: "the-prompt-used",
      userNote: "another issue",
      requestedBy: "tester",
    });

    const all = await listOptimizationRequestsForProject({ projectId });
    expect(all.length).toBe(2);
    // Newest first
    expect(all[0]?.stepName).toBe("step-b");
    expect(all[1]?.stepName).toBe("step-a");

    const open = await listOptimizationRequestsForProject({ projectId, status: "open" });
    expect(open.length).toBe(2);
  });

  it("transitions status to 'addressed' with note", async () => {
    const all = await listOptimizationRequestsForProject({ projectId });
    const first = all[0];
    if (!first) throw new Error("expected at least one request");

    const updated = await updateOptimizationRequestStatus({
      id: first.id,
      status: "addressed",
      addressedNote: "fixed via promoted golden v2",
    });
    expect(updated?.status).toBe("addressed");
    expect(updated?.addressedNote).toBe("fixed via promoted golden v2");
    expect(updated?.addressedAt).not.toBeNull();

    const openOnly = await listOptimizationRequestsForProject({ projectId, status: "open" });
    expect(openOnly.length).toBe(1);
    const addressed = await listOptimizationRequestsForProject({
      projectId,
      status: "addressed",
    });
    expect(addressed.length).toBe(1);
  });

  it("returns null when updating a non-existent request", async () => {
    const result = await updateOptimizationRequestStatus({
      id: "00000000-0000-0000-0000-000000000000",
      status: "discarded",
    });
    expect(result).toBeNull();
  });
});
