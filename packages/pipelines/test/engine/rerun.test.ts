// Spec 62.6 §6.8 + §11: end-to-end rerun-from-step scenarios on TestPipeline.
//
// Three scenarios:
//   safe   — rerun a step with no destructive cleanup; later step_outputs cleared
//             via priorOutput trim + idempotency cache cleared so re-execute is fresh.
//   destructive — registers a pipeline cleanup hook whose describeImpact() reports
//             a non-empty dbWritesToRevert; verifies the impact preview surfaces it
//             and that the hook's execute() runs during executeRerunCleanup.
//   pause-supersede — verifies that step-pauses for later steps are auto-dismissed
//             when rerunning an earlier step.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  and,
  db,
  desc,
  eq,
  idempotencyOutputs,
  isNull,
  pipelineRuns,
  projects,
  stepPauses,
} from "@marketing-auto/db";
import {
  clearRerunCleanupHooksForTesting,
  computeRerunImpact,
  executeRerunCleanup,
  isPipelineSuspended,
  pipelineRegistry,
  registerRerunCleanupHook,
  runPipeline,
} from "../../src/engine/index.ts";
import { TestPipeline } from "../fixtures/test-pipeline.ts";

describe("Spec 62.6 rerun-from-step", () => {
  let projectId: string;
  const PIPELINE_NAME = "test:step-pause";

  beforeAll(async () => {
    const ts = Date.now();
    const [p] = await db
      .insert(projects)
      .values({
        slug: `rerun-test-${ts}`,
        name: "Rerun Integration Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;

    // Register once so the registry can look it up by name in computeRerunImpact()
    // and executeRerunCleanup(). The registry rejects re-registers; swallow that
    // since other test files in this folder may have registered it first.
    try {
      pipelineRegistry.register(new TestPipeline());
    } catch {
      // already registered — fine
    }
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  afterEach(async () => {
    clearRerunCleanupHooksForTesting();
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    await db.delete(stepPauses).where(eq(stepPauses.projectId, projectId));
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  });

  it("safe rerun — clears later step outputs + idempotency cache and re-executes", async () => {
    // Drive the pipeline to a pause at step-b so we have outputs in the checkpoint.
    const r1 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      { projectId, runMode: "debug" },
    );
    if (!isPipelineSuspended(r1)) throw new Error("expected suspend at A");
    const pA = await getLatestPause(projectId);
    const r2 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 } },
        stepPauseResume: {
          stepName: "step-a",
          action: "approve",
          storedOutput: pA.stepOutput,
          stepPauseId: pA.id,
        },
      },
    );
    if (!isPipelineSuspended(r2)) throw new Error("expected suspend at B");

    // Preflight: rerun from step-a should report 2 later steps and no destructive impact.
    const impact = await computeRerunImpact({
      pipelineName: PIPELINE_NAME,
      pipelineRunId: r1.runId,
      projectId,
      fromStepName: "step-a",
    });
    expect(impact.safe).toBe(true);
    expect(impact.requiresConfirm).toBe(false);
    expect(impact.stepsToInvalidate).toEqual(["step-b", "step-c"]);
    expect(impact.dbWritesToRevert).toEqual([]);
    expect(impact.itemsToCancel).toBe(0);

    // Pre-populate an idempotency entry for step-c so we can verify it's cleared.
    await db.insert(idempotencyOutputs).values({
      idempotencyKey: "doubled:10",
      pipelineName: PIPELINE_NAME,
      stepName: "step-c",
      projectId,
      stepOutput: { final: 11, llm: "stale" },
      costEur: "0",
    });

    // Execute cleanup with a checkpoint that holds step-a + step-b outputs.
    // The checkpoint is on the parent run row; set it manually since the runner
    // would set it during a real pause, but we want to control the test state.
    await db
      .update(pipelineRuns)
      .set({
        suspensionCheckpoint: {
          kind: "step_pause",
          stepKey: "step-b",
          accumulatedOutput: {
            "step-a": { value: 10 },
            "step-b": { doubled: 10, llm: "default-prompt" },
            "step-c": { final: 11, llm: "stale" },
          },
        },
      })
      .where(eq(pipelineRuns.id, r1.runId));

    const cleanup = await executeRerunCleanup({
      pipelineName: PIPELINE_NAME,
      pipelineRunId: r1.runId,
      projectId,
      fromStepName: "step-a",
    });

    // priorOutput trimmed: step-a/b/c all dropped because they're at or after the rerun point.
    expect(cleanup.trimmedPriorOutput).toEqual({});

    // Idempotency rows for step-a, step-b, step-c are gone.
    const remainingIdem = await db
      .select()
      .from(idempotencyOutputs)
      .where(eq(idempotencyOutputs.projectId, projectId));
    expect(remainingIdem.length).toBe(0);

    // suspensionCheckpoint is cleared so the UI doesn't show stale "paused at" meta.
    const [parentAfter] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, r1.runId))
      .limit(1);
    expect(parentAfter?.suspensionCheckpoint).toBe(null);
  });

  it("destructive rerun — hook impact reaches the preview and execute() fires during cleanup", async () => {
    let executedFromStep = "";
    registerRerunCleanupHook(PIPELINE_NAME, {
      async describeImpact() {
        return {
          dbWritesToRevert: ["weekly_plans/abc123", "planned_items/5x"],
          itemsToCancel: 7,
        };
      },
      async execute(ctx) {
        executedFromStep = ctx.fromStepName;
      },
    });

    const impact = await computeRerunImpact({
      pipelineName: PIPELINE_NAME,
      pipelineRunId: "00000000-0000-0000-0000-000000000001",
      projectId,
      fromStepName: "step-b",
    });
    expect(impact.safe).toBe(false);
    expect(impact.requiresConfirm).toBe(true);
    expect(impact.dbWritesToRevert).toEqual(["weekly_plans/abc123", "planned_items/5x"]);
    expect(impact.itemsToCancel).toBe(7);
    expect(impact.stepsToInvalidate).toEqual(["step-c"]);

    // Insert a parent pipeline_runs row so executeRerunCleanup can update its
    // suspensionCheckpoint column.
    const [parent] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: PIPELINE_NAME,
        status: "paused",
        input: { x: 5 },
        suspensionCheckpoint: {
          kind: "step_pause",
          stepKey: "step-b",
          accumulatedOutput: { "step-a": { value: 10 } },
        },
      })
      .returning();
    if (!parent) throw new Error("parent insert failed");

    await executeRerunCleanup({
      pipelineName: PIPELINE_NAME,
      pipelineRunId: parent.id,
      projectId,
      fromStepName: "step-b",
    });
    expect(executedFromStep).toBe("step-b");
  });

  it("rerun supersedes later step-pauses on the same run", async () => {
    // Seed a parent run + a child substep pause for step-c (the "later step" we want to clean up).
    const [parent] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: PIPELINE_NAME,
        status: "paused",
        input: { x: 5 },
        suspensionCheckpoint: {
          kind: "step_pause",
          stepKey: "step-b",
          accumulatedOutput: {
            "step-a": { value: 10 },
            "step-b": { doubled: 10, llm: "default-prompt" },
          },
        },
      })
      .returning();
    if (!parent) throw new Error("parent insert failed");
    const [childC] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: PIPELINE_NAME,
        stepName: "step-c",
        status: "paused",
        parentRunId: parent.id,
        input: { doubled: 10, llm: "default-prompt" },
        output: { final: 11, llm: "default-prompt" },
      })
      .returning();
    if (!childC) throw new Error("child insert failed");
    // A step_pause for step-c — to be auto-dismissed by the rerun.
    await db.insert(stepPauses).values({
      pipelineRunId: parent.id,
      stepRunId: childC.id,
      stepName: "step-c",
      pipelineName: PIPELINE_NAME,
      projectId,
      stepInput: { doubled: 10, llm: "default-prompt" },
      stepOutput: { final: 11, llm: "default-prompt" },
      promptUsed: null,
    });

    // Rerun from step-b → step-c's pause should be auto-dismissed and step-c's
    // child row should be marked superseded.
    await executeRerunCleanup({
      pipelineName: PIPELINE_NAME,
      pipelineRunId: parent.id,
      projectId,
      fromStepName: "step-b",
    });

    const pauseC = await db
      .select()
      .from(stepPauses)
      .where(and(eq(stepPauses.pipelineRunId, parent.id), eq(stepPauses.stepName, "step-c")))
      .limit(1);
    expect(pauseC[0]?.action).toBe("auto-dismissed");
    expect(pauseC[0]?.resolvedAt).not.toBe(null);

    const [childAfter] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, childC.id))
      .limit(1);
    expect(childAfter?.status).toBe("superseded");
  });
});

async function getLatestPause(projectId: string) {
  const rows = await db
    .select()
    .from(stepPauses)
    .where(and(eq(stepPauses.projectId, projectId), isNull(stepPauses.resolvedAt)))
    .orderBy(desc(stepPauses.requestedAt))
    .limit(1);
  const latest = rows[0];
  if (!latest) throw new Error("no unresolved pause found");
  return latest;
}
