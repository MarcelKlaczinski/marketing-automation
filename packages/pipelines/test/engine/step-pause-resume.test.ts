// Spec 62.0a Section 8.2: 9 end-to-end runner scenarios on the 3-step TestPipeline.
// All scenarios call runPipeline() directly (no BullMQ), simulating the resolve service
// by manually constructing PipelineRunOptions.stepPauseResume + priorOutput.

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
import { isPipelineSuspended, runPipeline } from "../../src/engine/index.ts";
import { TestPipeline } from "../fixtures/test-pipeline.ts";

describe("Spec 62.0a runner integration — 9 scenarios", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `step-pause-test-${Date.now()}`,
        name: "Step-Pause Integration Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  afterEach(async () => {
    // Reset idempotency cache + step_pauses between scenarios so each test starts clean.
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    await db.delete(stepPauses).where(eq(stepPauses.projectId, projectId));
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
  });

  // ─── Scenario 1: production all-execute ────────────────────────────────────
  it("scenario 1 — production mode runs all 3 steps end-to-end", async () => {
    const result = await runPipeline(new TestPipeline(), { x: 5 }, { projectId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Step A: x=5 → value=10. Step B: doubled=10. Step C: final=11, llm="default-prompt".
      expect(result.output).toEqual({ final: 11, llm: "default-prompt" });
    }

    // No pauses created in production mode.
    const pauses = await db
      .select()
      .from(stepPauses)
      .where(eq(stepPauses.projectId, projectId));
    expect(pauses.length).toBe(0);
  });

  // ─── Scenario 2: debug-mode all-approve ────────────────────────────────────
  it("scenario 2 — debug mode pauses after step A, approve resumes through B and C", async () => {
    // First run: pauses after step-a.
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
    expect(isPipelineSuspended(r1)).toBe(true);
    if (!isPipelineSuspended(r1)) return;
    expect(r1.stepKey).toBe("step-a");

    const pause1 = await getLatestPause(projectId);
    expect(pause1.stepName).toBe("step-a");
    expect(pause1.stepOutput).toEqual({ value: 10 });

    // Approve A → re-enter, should pause after step-b.
    const accumulated1 = { "step-a": { value: 10 } };
    const r2 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: accumulated1,
        stepPauseResume: {
          stepName: "step-a",
          action: "approve",
          storedOutput: pause1.stepOutput,
          stepPauseId: pause1.id,
        },
      }
    );
    expect(isPipelineSuspended(r2)).toBe(true);
    if (!isPipelineSuspended(r2)) return;
    expect(r2.stepKey).toBe("step-b");

    const pause2 = await getLatestPause(projectId);
    expect(pause2.stepName).toBe("step-b");
    expect(pause2.stepOutput).toEqual({ doubled: 10, llm: "default-prompt" });

    // Approve B → pauses after C.
    const accumulated2 = { "step-a": { value: 10 }, "step-b": { doubled: 10, llm: "default-prompt" } };
    const r3 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: accumulated2,
        stepPauseResume: {
          stepName: "step-b",
          action: "approve",
          storedOutput: pause2.stepOutput,
          stepPauseId: pause2.id,
        },
      }
    );
    expect(isPipelineSuspended(r3)).toBe(true);
    if (!isPipelineSuspended(r3)) return;
    expect(r3.stepKey).toBe("step-c");

    const pause3 = await getLatestPause(projectId);
    expect(pause3.stepOutput).toEqual({ final: 11, llm: "default-prompt" });

    // Approve C → pipeline completes.
    const accumulated3 = { ...accumulated2, "step-c": { final: 11, llm: "default-prompt" } };
    const r4 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: accumulated3,
        stepPauseResume: {
          stepName: "step-c",
          action: "approve",
          storedOutput: pause3.stepOutput,
          stepPauseId: pause3.id,
        },
      }
    );
    expect(r4.ok).toBe(true);
    if (r4.ok) {
      expect(r4.output).toEqual({ final: 11, llm: "default-prompt" });
    }
  });

  // ─── Scenario 3: edit-output at B ──────────────────────────────────────────
  it("scenario 3 — edit-output at B overwrites step B's output, pipeline finishes with edited value", async () => {
    // Run to pause at A, approve A, then we'll pause at B.
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
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
      }
    );
    if (!isPipelineSuspended(r2)) throw new Error("expected suspend at B");
    const pB = await getLatestPause(projectId);

    // Edit B's output: doubled := 99.
    const editedB = { doubled: 99, llm: "default-prompt" };
    const r3 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 }, "step-b": { doubled: 10, llm: "default-prompt" } },
        stepPauseResume: {
          stepName: "step-b",
          action: "edit-output",
          storedOutput: pB.stepOutput,
          editedOutput: editedB,
          stepPauseId: pB.id,
        },
      }
    );
    if (!isPipelineSuspended(r3)) throw new Error("expected suspend at C");

    // Pause at C should see doubled=99 in its input.
    const pC = await getLatestPause(projectId);
    expect(pC.stepName).toBe("step-c");
    expect(pC.stepInput).toEqual({ doubled: 99, llm: "default-prompt" });
    expect(pC.stepOutput).toEqual({ final: 100, llm: "default-prompt" });
  });

  // ─── Scenario 4: edit-input at C ───────────────────────────────────────────
  it("scenario 4 — edit-input at C re-executes C with the supplied input", async () => {
    // Drive through A and B normally, then pause at C and edit-input.
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
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
      }
    );
    if (!isPipelineSuspended(r2)) throw new Error("expected suspend at B");
    const pB = await getLatestPause(projectId);

    const r3 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 }, "step-b": { doubled: 10, llm: "default-prompt" } },
        stepPauseResume: {
          stepName: "step-b",
          action: "approve",
          storedOutput: pB.stepOutput,
          stepPauseId: pB.id,
        },
      }
    );
    if (!isPipelineSuspended(r3)) throw new Error("expected suspend at C");
    const pC = await getLatestPause(projectId);

    // Edit-input at C: doubled=99 instead of 10.
    const r4 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 }, "step-b": { doubled: 10, llm: "default-prompt" } },
        stepPauseResume: {
          stepName: "step-c",
          action: "edit-input",
          storedOutput: pC.stepOutput,
          editedInput: { doubled: 99, llm: "custom-via-edit-input" },
          stepPauseId: pC.id,
        },
      }
    );
    if (!isPipelineSuspended(r4)) throw new Error("expected re-suspend at C after edit-input");
    const pCagain = await getLatestPause(projectId);
    expect(pCagain.stepName).toBe("step-c");
    expect(pCagain.stepInput).toEqual({ doubled: 99, llm: "custom-via-edit-input" });
    expect(pCagain.stepOutput).toEqual({ final: 100, llm: "custom-via-edit-input" });
  });

  // ─── Scenario 5: edit-prompt at B ──────────────────────────────────────────
  it("scenario 5 — edit-prompt at B re-executes B with the override; step output reflects it", async () => {
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
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
      }
    );
    if (!isPipelineSuspended(r2)) throw new Error("expected suspend at B");
    const pB = await getLatestPause(projectId);

    // Edit-prompt at B with a custom string.
    const r3 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 } },
        stepPauseResume: {
          stepName: "step-b",
          action: "edit-prompt",
          storedOutput: pB.stepOutput,
          editedPrompt: "you-are-a-pirate",
          stepPauseId: pB.id,
        },
      }
    );
    if (!isPipelineSuspended(r3)) throw new Error("expected re-suspend at B");
    const pBagain = await getLatestPause(projectId);
    expect(pBagain.stepName).toBe("step-b");
    // Step B reads ctx.promptOverride[stepName] and stores it in output.llm.
    expect(pBagain.stepOutput).toEqual({ doubled: 10, llm: "you-are-a-pirate" });
    expect(pBagain.promptUsed).toBe("you-are-a-pirate");
  });

  // ─── Scenario 6: abort at A ────────────────────────────────────────────────
  it("scenario 6 — abort at A marks parent run cancelled and auto-dismisses pauses", async () => {
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
    if (!isPipelineSuspended(r1)) throw new Error("expected suspend at A");
    const pA = await getLatestPause(projectId);

    const r2 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: {},
        stepPauseResume: {
          stepName: "step-a",
          action: "abort",
          storedOutput: pA.stepOutput,
          stepPauseId: pA.id,
        },
      }
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok && "error" in r2) {
      expect(r2.error).toBe("aborted");
    }

    // Parent run is cancelled.
    const [run] = await db
      .select({ status: pipelineRuns.status })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, r1.runId))
      .limit(1);
    expect(run!.status).toBe("cancelled");

    // Pause A is auto-dismissed.
    const [dismissed] = await db
      .select({ action: stepPauses.action, resolvedBy: stepPauses.resolvedBy })
      .from(stepPauses)
      .where(eq(stepPauses.id, pA.id));
    expect(dismissed!.action).toBe("auto-dismissed");
    expect(dismissed!.resolvedBy).toBe("system");
  });

  // ─── Scenario 7: idempotency cache hit ─────────────────────────────────────
  it("scenario 7 — second run with same input hits idempotency cache for A and C", async () => {
    // First run completes end-to-end and populates the cache.
    const r1 = await runPipeline(new TestPipeline(), { x: 7 }, { projectId });
    expect(r1.ok).toBe(true);

    // Cache has 2 entries (step-a + step-c; step-b has no idempotencyKey).
    const cached = await db
      .select()
      .from(idempotencyOutputs)
      .where(eq(idempotencyOutputs.projectId, projectId));
    const stepNames = new Set(cached.map((c) => c.stepName));
    expect(stepNames.has("step-a")).toBe(true);
    expect(stepNames.has("step-c")).toBe(true);
    expect(stepNames.has("step-b")).toBe(false);

    // Second run — A and C come from cache (no new substep execution); B re-executes.
    const r2 = await runPipeline(new TestPipeline(), { x: 7 }, { projectId });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.output).toEqual({ final: 15, llm: "default-prompt" });
    }
    // No additional cache entries (the second run hit existing keys).
    const cachedAfter = await db
      .select()
      .from(idempotencyOutputs)
      .where(eq(idempotencyOutputs.projectId, projectId));
    expect(cachedAfter.length).toBe(cached.length);
  });

  // ─── Scenario 8: promote-golden at B ───────────────────────────────────────
  it("scenario 8 — promote-golden behaves like approve in 62.0a (editedPrompt persisted for 62.0b)", async () => {
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
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
      }
    );
    if (!isPipelineSuspended(r2)) throw new Error("expected suspend at B");
    const pB = await getLatestPause(projectId);

    const r3 = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: { "step-a": { value: 10 }, "step-b": { doubled: 10, llm: "default-prompt" } },
        stepPauseResume: {
          stepName: "step-b",
          action: "promote-golden",
          storedOutput: pB.stepOutput,
          editedPrompt: "this-prompt-should-become-canonical",
          stepPauseId: pB.id,
        },
      }
    );
    // Behaves like approve → next step pauses.
    expect(isPipelineSuspended(r3)).toBe(true);
    if (!isPipelineSuspended(r3)) return;
    expect(r3.stepKey).toBe("step-c");
  });

  // ─── Scenario 9: extract-for-optimization at B ─────────────────────────────
  // The resolve service is responsible for NOT re-enqueueing for this action. If the
  // runner somehow receives it (defensive path), it re-suspends without making progress.
  it("scenario 9 — extract-for-optimization re-suspends without resuming", async () => {
    const r1 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId, runMode: "debug" });
    if (!isPipelineSuspended(r1)) throw new Error("expected suspend at A");
    const pA = await getLatestPause(projectId);

    // Force the runner to handle extract-for-optimization (real flow: service short-circuits).
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
          action: "extract-for-optimization",
          storedOutput: pA.stepOutput,
          stepPauseId: pA.id,
        },
      }
    );
    expect(isPipelineSuspended(r2)).toBe(true);
    if (!isPipelineSuspended(r2)) return;
    expect(r2.error).toBe("step_extract_for_optimization");
    expect(r2.stepKey).toBe("step-a");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getLatestPause(projectId: string) {
  // Tests bypass the resolve service, so prior pauses stay UNRESOLVED across re-entries.
  // Sort by requestedAt DESC to always pick the most recent one.
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
