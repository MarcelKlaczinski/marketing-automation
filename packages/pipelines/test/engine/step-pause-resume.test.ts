// Spec 62.0a Section 8.2 + Spec 62.0b: end-to-end runner scenarios on the 3-step
// TestPipeline. All scenarios call runPipeline() directly (no BullMQ), simulating the
// resolve service by manually constructing PipelineRunOptions.stepPauseResume + priorOutput.

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
  promptVersions,
  stepPauses,
} from "@marketing-auto/db";
import { isPipelineSuspended, runPipeline } from "../../src/engine/index.ts";
import { clearGoldenPromptCacheForTesting } from "../../src/engine/golden-prompt-cache.ts";
import { TestPipeline } from "../fixtures/test-pipeline.ts";

describe("Spec 62.0a + 62.0b runner integration", () => {
  let projectId: string;
  let secondProjectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [p] = await db
      .insert(projects)
      .values({
        slug: `step-pause-test-${ts}`,
        name: "Step-Pause Integration Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;

    // Second project for Scenario 13 (hybrid resolution across projects).
    const [p2] = await db
      .insert(projects)
      .values({
        slug: `step-pause-test-2-${ts}`,
        name: "Step-Pause Integration Test 2",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p2) throw new Error("second project insert failed");
    secondProjectId = p2.id;
  });

  afterAll(async () => {
    // Delete global goldens (no project_id) that the cascade can't reach.
    await db.delete(promptVersions).where(isNull(promptVersions.projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, secondProjectId));
  });

  afterEach(async () => {
    // Reset idempotency cache + step_pauses + prompt_versions + in-process golden cache
    // between scenarios so each test starts clean.
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    await db.delete(stepPauses).where(eq(stepPauses.projectId, projectId));
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
    await db.delete(promptVersions).where(eq(promptVersions.projectId, projectId));
    await db.delete(promptVersions).where(eq(promptVersions.projectId, secondProjectId));
    await db.delete(promptVersions).where(isNull(promptVersions.projectId));
    clearGoldenPromptCacheForTesting();
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

  // ─── Scenario 10 (Spec 62.0b): promote-golden persists prompt_versions row ────
  // After approving Step A, we promote-golden at Step B with a custom editedPrompt.
  // We verify the row is written with isGolden=true AND a *second* fresh pipeline run
  // (no override / no stepPauseResume) picks up the golden via resolvePrompt() and
  // step-c's output reflects the new prompt body.
  it("scenario 10 — promote-golden writes prompt_versions row and a fresh re-run uses it", async () => {
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

    await runPipeline(
      new TestPipeline(),
      { x: 5 },
      {
        projectId,
        runMode: "debug",
        preRunId: r1.runId,
        priorOutput: {
          "step-a": { value: 10 },
          "step-b": { doubled: 10, llm: "default-prompt" },
        },
        stepPauseResume: {
          stepName: "step-b",
          action: "promote-golden",
          storedOutput: pB.stepOutput,
          editedPrompt: "custom-suffix-v1",
          stepPauseId: pB.id,
        },
      }
    );

    // prompt_versions has exactly one isGolden row for (step-b, projectId).
    const goldens = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.projectId, projectId));
    expect(goldens.length).toBe(1);
    expect(goldens[0]?.stepName).toBe("step-b");
    expect(goldens[0]?.body).toBe("custom-suffix-v1");
    expect(goldens[0]?.isGolden).toBe(true);
    expect(goldens[0]?.sourcePauseId).toBe(pB.id);

    // Fresh re-run in production mode, no override, no resume. The hybrid resolver
    // must pick up the golden from the DB and TestStepB's output should contain it.
    clearGoldenPromptCacheForTesting(); // ensure DB lookup happens
    // The idempotency cache still holds step-a's prior output (idempotencyKey="x:5")
    // and step-c's (idempotencyKey="doubled:10"), so those hits will reuse cached
    // outputs that were generated with the OLD prompt body. Clear them so step-c
    // re-executes against the fresh step-b output.
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    const r3 = await runPipeline(new TestPipeline(), { x: 5 }, { projectId });
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.output.llm).toBe("custom-suffix-v1");
    }
  });

  // ─── Scenario 11 (Spec 62.0b): second promote supersedes the first ────────────
  it("scenario 11 — second promote-golden supersedes the first (same step, same project)", async () => {
    // First promote → v1
    await runWithPromote(projectId, "v1-prompt");
    const afterV1 = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.projectId, projectId));
    expect(afterV1.length).toBe(1);
    expect(afterV1[0]?.body).toBe("v1-prompt");
    expect(afterV1[0]?.isGolden).toBe(true);

    // Second promote → v2 supersedes v1
    // Clear the in-between state because runWithPromote leaves rows behind.
    await db.delete(stepPauses).where(eq(stepPauses.projectId, projectId));
    await db.delete(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    clearGoldenPromptCacheForTesting();
    await runWithPromote(projectId, "v2-prompt");

    const afterV2 = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.projectId, projectId))
      .orderBy(desc(promptVersions.createdAt));
    expect(afterV2.length).toBe(2);
    expect(afterV2[0]?.body).toBe("v2-prompt");
    expect(afterV2[0]?.isGolden).toBe(true);
    expect(afterV2[1]?.body).toBe("v1-prompt");
    expect(afterV2[1]?.isGolden).toBe(false);
    expect(afterV2[1]?.supersededAt).not.toBeNull();

    // Fresh re-run picks up v2.
    clearGoldenPromptCacheForTesting();
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    const fresh = await runPipeline(new TestPipeline(), { x: 5 }, { projectId });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.output.llm).toBe("v2-prompt");
  });

  // ─── Scenario 13 (Spec 62.0b): hybrid resolution order ────────────────────────
  // Tier 1 (debug override) > Tier 2 (project golden) > Tier 3 (global golden) > Tier 4 (file default).
  it("scenario 13 — hybrid resolution: project > global > file default; ctx.promptOverride beats all", async () => {
    // Seed: global golden + project-A golden, no project-B golden.
    const { promoteToGolden } = await import("@marketing-auto/db");
    await promoteToGolden({
      stepName: "step-b",
      projectId: null,
      body: "global-prompt",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });
    await promoteToGolden({
      stepName: "step-b",
      projectId,
      body: "project-prompt",
      sourcePauseId: null,
      promoteNote: null,
      createdBy: "test",
    });
    clearGoldenPromptCacheForTesting();

    // Project A picks project-prompt (Tier 2 wins over Tier 3).
    const rA = await runPipeline(new TestPipeline(), { x: 5 }, { projectId });
    expect(rA.ok).toBe(true);
    if (rA.ok) expect(rA.output.llm).toBe("project-prompt");

    // Project B has no project-golden, so falls through to global (Tier 3).
    const rB = await runPipeline(new TestPipeline(), { x: 5 }, { projectId: secondProjectId });
    expect(rB.ok).toBe(true);
    if (rB.ok) expect(rB.output.llm).toBe("global-prompt");

    // Project A with ctx.promptOverride wins over both (Tier 1).
    // Use promptOverride from PipelineRunOptions (drives ctx.promptOverride inside steps).
    await db.delete(idempotencyOutputs).where(eq(idempotencyOutputs.projectId, projectId));
    const rOverride = await runPipeline(
      new TestPipeline(),
      { x: 5 },
      { projectId, promptOverride: { "step-b": "debug-override" } }
    );
    expect(rOverride.ok).toBe(true);
    if (rOverride.ok) expect(rOverride.output.llm).toBe("debug-override");
  });
});

// Helper: pause at step-b and promote with the given prompt body.
async function runWithPromote(projectId: string, editedPrompt: string) {
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

  await runPipeline(
    new TestPipeline(),
    { x: 5 },
    {
      projectId,
      runMode: "debug",
      preRunId: r1.runId,
      priorOutput: {
        "step-a": { value: 10 },
        "step-b": { doubled: 10, llm: "default-prompt" },
      },
      stepPauseResume: {
        stepName: "step-b",
        action: "promote-golden",
        storedOutput: pB.stepOutput,
        editedPrompt,
        stepPauseId: pB.id,
      },
    }
  );
}

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
