import { publishPipelineEvent } from "@marketing-auto/core/events";
import { notifyStepPaused } from "@marketing-auto/core/notifications";
import {
  autoDismissStepPauses,
  db,
  getIdempotencyOutput,
  persistStepPause,
  pipelineRuns,
  projects,
  promoteToGolden,
  supersedeOldSubstep,
  writeIdempotencyOutput,
} from "@marketing-auto/db";
import type { SuspensionCheckpoint } from "@marketing-auto/db";
import { type StepAction, createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { invalidateGoldenPromptCache } from "./golden-prompt-cache.ts";
import type { Pipeline } from "./pipeline.ts";
import type { BaseStep, StepContext } from "./step.ts";

const log = createLogger("pipeline-runner");

/**
 * Spec 62.0a: payload reconstructed by step-pause-service from a resolved step_pauses row,
 * passed back through enqueuePipeline → runPipeline. The runner uses `action` to decide
 * whether to skip the step (approve / edit-output / promote-golden), re-execute with
 * overridden input (edit-input), re-execute with overridden prompt (edit-prompt), or
 * abort / re-suspend (abort / extract-for-optimization).
 *
 * Shape mirrors the queue's Zod `stepPauseResumeSchema` so the type flows cleanly through
 * jobData parse → runPipeline opts without intermediate casts.
 */
export interface StepPauseResume {
  stepName: string;
  action: StepAction;
  storedOutput?: unknown;
  editedInput?: unknown;
  editedOutput?: unknown;
  editedPrompt?: string;
  stepPauseId: string;
  /**
   * Spec 62.0b: identifier of whoever resolved the pause (user email/id or "system").
   * Threaded through to `prompt_versions.created_by` when action='promote-golden'.
   * Optional for backward-compat with pre-62.0b job payloads still in flight.
   */
  resolvedBy?: string;
}

export type PipelineRunOptions = {
  projectId: string;
  parentRunId?: string;
  /** BullMQ job ID for correlation */
  jobId?: string;
  /** Pre-created pipeline_runs row ID. Runner will UPDATE it instead of INSERT a new row. */
  preRunId?: string;
  // Spec 61.4: batch resume — skip completed steps and inject cached LLM content
  resumeFromStep?: string;
  batchResult?: { stepKey: string; content: string };
  priorOutput?: Record<string, unknown>;
  // Spec 62.0a: execution mode + LLM mode override + step-pause resume payload + prompt override
  runMode?: "production" | "debug";
  overrideLlmMode?: "sync" | "batch";
  stepPauseResume?: StepPauseResume;
  /** Per-step prompt overrides keyed by step.name. Populated by edit-prompt resume action. */
  promptOverride?: Record<string, string>;
  /** Per-step input overrides keyed by step.name. Populated by edit-input resume action. */
  stepInputOverride?: Record<string, unknown>;
};

export type PipelineRunResult<TOutput> =
  | {
      ok: true;
      suspended?: false;
      runId: string;
      output: TOutput;
      stepOutputs: Record<string, unknown>;
    }
  | {
      ok: false;
      suspended?: false;
      runId: string;
      error: string;
      failedAtStep: string;
      stepOutputs: Record<string, unknown>;
    }
  | {
      // Project was deleted between enqueue and worker pickup (e.g. test cleanup race —
      // BullMQ job survives in Redis after PG CASCADE wipes the projects row). No
      // pipeline_runs row is inserted; the BullMQ worker treats this as a clean
      // completion so no "Pipeline failed" notification fires.
      ok: false;
      suspended?: false;
      runId: "";
      error: "project_deleted";
      failedAtStep: "";
      stepOutputs: Record<string, unknown>;
      projectId: string;
    }
  | {
      // Spec 61.4 Pattern 118: pipeline suspended pending Anthropic Batch API result.
      // ok: false so BullMQ job doesn't count this as a successful pipeline completion.
      // Processor will resume the pipeline when the batch result arrives.
      ok: false;
      suspended: true;
      runId: string;
      error: "batch_suspended";
      failedAtStep: "";
      stepOutputs: Record<string, unknown>;
      stepKey: string;
      batchRequestId: string;
    }
  | {
      // Spec 62.0a: pipeline suspended awaiting user resolution of a step-pause.
      // BullMQ treats this as a successful job completion (no retry); the API
      // endpoint POST /pipeline-runs/:id/step-pauses/:id/resolve re-enqueues.
      ok: false;
      suspended: true;
      runId: string;
      error: "step_paused" | "step_extract_for_optimization";
      failedAtStep: "";
      stepOutputs: Record<string, unknown>;
      stepKey: string;
      stepPauseId: string;
    };

/** Type guard: true when the pipeline suspended waiting for batch result OR user step-pause resolution. */
export function isPipelineSuspended<T>(
  result: PipelineRunResult<T>
): result is Extract<PipelineRunResult<T>, { suspended: true }> {
  return !result.ok && (result as { suspended?: boolean }).suspended === true;
}

/**
 * Runs a pipeline synchronously (no BullMQ).
 * Persists pipeline_runs rows for audit. Updates progress.
 *
 * Errors during step execution are caught and recorded in the pipeline_runs row,
 * then re-thrown so BullMQ (if calling) sees the failure for retry.
 */
export async function runPipeline<TInput, TOutput>(
  pipeline: Pipeline<TInput, TOutput>,
  input: TInput,
  options: PipelineRunOptions,
  reportJobProgress?: (percent: number) => Promise<void>
): Promise<PipelineRunResult<TOutput>> {
  const validatedInput = pipeline.inputSchema.parse(input);

  // Spec 61.4: load project's LLM mode once at pipeline start and pass to every step.
  // Spec 62.0a: PipelineRunOptions.overrideLlmMode is a per-run escape hatch.
  // Also serves as the "project still exists" guard — bail out before any
  // pipeline_runs INSERT if the project was deleted while the job sat in BullMQ.
  // ON DELETE CASCADE wipes related DB rows but BullMQ jobs live in Redis and
  // survive the delete; the worker discriminates on error="project_deleted" and
  // returns clean instead of marking the job failed.
  const [projectRow] = await db
    .select({ llmMode: projects.llmMode })
    .from(projects)
    .where(eq(projects.id, options.projectId))
    .limit(1);
  if (!projectRow) {
    log.info(
      { pipelineName: pipeline.name, projectId: options.projectId, jobId: options.jobId },
      "Pipeline skipped: project no longer exists (race with delete)"
    );
    return {
      ok: false,
      runId: "",
      error: "project_deleted",
      failedAtStep: "",
      stepOutputs: {},
      projectId: options.projectId,
    };
  }
  const projectLlmMode = (projectRow.llmMode ?? "sync") as "sync" | "batch";
  const llmMode: "sync" | "batch" = options.overrideLlmMode ?? projectLlmMode;
  const runMode: "production" | "debug" = options.runMode ?? "production";

  let runId: string;
  if (options.preRunId) {
    // Settle the pre-created "queued" row to "running" instead of inserting a new one.
    await db
      .update(pipelineRuns)
      .set({ status: "running", jobId: options.jobId ?? null, startedAt: new Date() })
      .where(eq(pipelineRuns.id, options.preRunId));
    runId = options.preRunId;
  } else {
    const [parentRun] = await db
      .insert(pipelineRuns)
      .values({
        projectId: options.projectId,
        pipelineName: pipeline.name,
        stepName: null,
        status: "running",
        jobId: options.jobId ?? null,
        parentRunId: options.parentRunId ?? null,
        input: validatedInput as Record<string, unknown>,
        startedAt: new Date(),
      })
      .returning({ id: pipelineRuns.id });
    runId = parentRun!.id;
  }
  const pipelineLog = log.child({ runId, pipeline: pipeline.name, projectId: options.projectId });
  pipelineLog.info({ stepCount: pipeline.steps.length }, "Pipeline started");

  const pipelineStartTime = Date.now();
  void publishPipelineEvent(options.projectId, {
    type: "pipeline.started",
    runId,
    pipelineName: pipeline.name,
    timestamp: new Date().toISOString(),
  });

  const stepOutputs: Record<string, unknown> = {};
  let currentInput: unknown = validatedInput;
  let lastStepName = "(none)";
  // Spec 62.0a: edit-input and edit-prompt resume actions install per-step overrides
  // that the loop applies before each step's input/ctx is built.
  const stepInputOverride: Record<string, unknown> = { ...(options.stepInputOverride ?? {}) };
  const promptOverride: Record<string, string> = { ...(options.promptOverride ?? {}) };
  let resumeFromStep: string | undefined = options.resumeFromStep;

  // Spec 61.4 + 62.0a: pre-populate stepOutputs from the suspension checkpoint so the runner
  // can skip steps that already completed before the pipeline suspended. Used by both
  // batch resume (SuspensionCheckpoint.accumulatedOutput) and step-pause resume.
  if (options.priorOutput) {
    for (const [k, v] of Object.entries(options.priorOutput)) {
      stepOutputs[k] = v;
    }
  }

  // Spec 62.0a Section 4.3: translate step-pause resume action into runner state.
  // Six user-driven actions reach the runner; extract-for-optimization and auto-dismissed
  // are handled by the resolve service (no re-enqueue) and should never appear here.
  if (options.stepPauseResume) {
    const resume = options.stepPauseResume;
    const targetIdx = pipeline.steps.findIndex((s) => s.name === resume.stepName);
    if (targetIdx === -1) {
      throw new Error(
        `stepPauseResume references unknown step '${resume.stepName}' in pipeline '${pipeline.name}'`
      );
    }
    const targetStep = pipeline.steps[targetIdx] as BaseStep<unknown, unknown>;

    switch (resume.action) {
      case "abort": {
        await db
          .update(pipelineRuns)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(eq(pipelineRuns.id, runId));
        await autoDismissStepPauses(runId, "cancelled");
        // Spec 62.6: live-update so the UI shows "cancelled" without refresh.
        void publishPipelineEvent(options.projectId, {
          type: "run.statusChanged",
          runId,
          pipelineName: pipeline.name,
          oldStatus: "paused",
          newStatus: "cancelled",
          timestamp: new Date().toISOString(),
        });
        pipelineLog.info({ stepName: resume.stepName }, "Pipeline aborted via step-pause resolve");
        return {
          ok: false,
          runId,
          error: "aborted",
          failedAtStep: resume.stepName,
          stepOutputs,
        };
      }
      case "approve": {
        stepOutputs[resume.stepName] = resume.storedOutput;
        const next = pipeline.steps[targetIdx + 1] as BaseStep<unknown, unknown> | undefined;
        resumeFromStep = next ? next.name : "__pipeline_complete__";
        break;
      }
      case "promote-golden": {
        // Spec 62.0b Section 5.1: persist the edited prompt as a project-scoped golden,
        // supersede any prior golden for the same (step, project), and invalidate the
        // in-process cache so the next pipeline run picks up the new prompt immediately.
        // Then continue exactly like 'approve' (output stays the same; the prompt only
        // affects FUTURE runs of this step on this project).
        if (resume.editedPrompt !== undefined && resume.editedPrompt.length > 0) {
          try {
            await promoteToGolden({
              stepName: resume.stepName,
              projectId: options.projectId, // project-scoped by default
              body: resume.editedPrompt,
              sourcePauseId: resume.stepPauseId,
              promoteNote: null,
              createdBy: resume.resolvedBy ?? "system",
            });
            invalidateGoldenPromptCache({
              stepName: resume.stepName,
              projectId: options.projectId,
            });
            pipelineLog.info(
              { stepName: resume.stepName, stepPauseId: resume.stepPauseId },
              "Promoted edited prompt to golden"
            );
          } catch (err) {
            // UNIQUE-constraint race or DB error — log loudly but don't block the resume.
            // The user still gets the runtime behaviour of 'approve' on this run.
            pipelineLog.warn(
              { err, stepName: resume.stepName, stepPauseId: resume.stepPauseId },
              "promote-golden persistence failed — falling through to approve semantics"
            );
          }
        } else {
          pipelineLog.warn(
            { stepName: resume.stepName, stepPauseId: resume.stepPauseId },
            "promote-golden resume action without editedPrompt — treating as approve"
          );
        }

        stepOutputs[resume.stepName] = resume.storedOutput;
        const next = pipeline.steps[targetIdx + 1] as BaseStep<unknown, unknown> | undefined;
        resumeFromStep = next ? next.name : "__pipeline_complete__";
        break;
      }
      case "edit-output": {
        const parsed = targetStep.outputSchema.parse(resume.editedOutput);
        stepOutputs[resume.stepName] = parsed;
        const next = pipeline.steps[targetIdx + 1] as BaseStep<unknown, unknown> | undefined;
        resumeFromStep = next ? next.name : "__pipeline_complete__";
        break;
      }
      case "edit-input": {
        delete stepOutputs[resume.stepName];
        resumeFromStep = resume.stepName;
        stepInputOverride[resume.stepName] = resume.editedInput;
        // Spec 62.0a Section 4.5.1: the previous substep row stays in the running/paused
        // state until we re-execute; mark it superseded so it doesn't linger orphan-running.
        await supersedeOldSubstep(runId, resume.stepName);
        break;
      }
      case "rerun": {
        // Spec 62.6 §6.8: re-execute this step with the ORIGINAL input (no override).
        // Differs from edit-input by leaving stepInputOverride empty — the runner's
        // bridge() rederives the step input from the previous step's output. Any later
        // step outputs that were cached in priorOutput (from a multi-pause iteration)
        // are also cleared so they re-execute fresh once this step completes.
        // Pipeline-specific DB cleanup (e.g. PlanWeekPipeline's planned_items rollback)
        // was performed by step-pause-service BEFORE re-enqueue, so the runner only
        // owns the in-memory state reset here.
        for (let j = targetIdx; j < pipeline.steps.length; j++) {
          const laterStep = pipeline.steps[j] as BaseStep<unknown, unknown>;
          delete stepOutputs[laterStep.name];
        }
        resumeFromStep = resume.stepName;
        await supersedeOldSubstep(runId, resume.stepName);
        break;
      }
      case "edit-prompt": {
        delete stepOutputs[resume.stepName];
        resumeFromStep = resume.stepName;
        if (resume.editedPrompt !== undefined) {
          promptOverride[resume.stepName] = resume.editedPrompt;
        }
        // Spec 62.0a Section 4.5.1: same supersession as edit-input — old substep is replaced.
        await supersedeOldSubstep(runId, resume.stepName);
        break;
      }
      case "extract-for-optimization":
      case "auto-dismissed": {
        // Defensive: the resolve service should never re-enqueue for these actions.
        // If we somehow reach here, re-suspend so the UI stays consistent.
        pipelineLog.warn(
          { action: resume.action, stepName: resume.stepName },
          "Unexpected step-pause resume action reached runner — re-suspending"
        );
        return {
          ok: false,
          suspended: true,
          runId,
          stepKey: resume.stepName,
          stepPauseId: resume.stepPauseId,
          error:
            resume.action === "extract-for-optimization"
              ? ("step_extract_for_optimization" as const)
              : ("step_paused" as const),
          failedAtStep: "" as const,
          stepOutputs,
        };
      }
    }
  }

  try {
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i] as BaseStep<unknown, unknown>;
      const overallProgress = Math.round((i / pipeline.steps.length) * 100);
      await reportJobProgress?.(overallProgress);

      // Spec 61.4 Pattern 118 + Spec 62.0a: skip any step whose output is already in
      // stepOutputs UNLESS it is the explicit resumeFromStep. This handles batch resume
      // (priorOutput pre-populated) AND step-pause approve/edit-output (storedOutput
      // pre-populated AND resumeFromStep advanced past the paused step).
      if (stepOutputs[step.name] !== undefined && step.name !== resumeFromStep) {
        const cachedOutput = stepOutputs[step.name];
        if (i < pipeline.steps.length - 1) {
          const nextStep = pipeline.steps[i + 1] as BaseStep<unknown, unknown>;
          currentInput = pipeline.bridge(
            step,
            nextStep,
            cachedOutput,
            validatedInput,
            <T>(name: string) => stepOutputs[name] as T | undefined
          );
        } else {
          currentInput = cachedOutput;
        }
        continue;
      }

      const stepLog = pipelineLog.child({ step: step.name });
      stepLog.info({ stepIndex: i }, "Step starting");

      // Spec 62.0a: edit-input resume action supplies a per-step input override.
      if (stepInputOverride[step.name] !== undefined) {
        currentInput = stepInputOverride[step.name];
      }

      const stepInput = step.inputSchema.parse(currentInput);

      const [stepRun] = await db
        .insert(pipelineRuns)
        .values({
          projectId: options.projectId,
          pipelineName: pipeline.name,
          stepName: step.name,
          status: "running",
          parentRunId: runId,
          input: stepInput as Record<string, unknown>,
          startedAt: new Date(),
        })
        .returning({ id: pipelineRuns.id });

      const stepRunId = stepRun!.id;

      // Spec 62.0a: idempotency cache check BEFORE execute. A HIT skips the step entirely.
      const idemKey = step.idempotencyKey(stepInput);
      if (idemKey) {
        const cached = await getIdempotencyOutput({
          idempotencyKey: idemKey,
          pipelineName: pipeline.name,
          stepName: step.name,
          projectId: options.projectId,
        });
        if (cached) {
          stepLog.info({ idemKey }, "Idempotency cache HIT — skipping execute");
          const parsedCached = step.outputSchema.parse(cached.stepOutput);
          await db
            .update(pipelineRuns)
            .set({
              status: "completed",
              output: parsedCached as Record<string, unknown>,
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.id, stepRunId));
          stepOutputs[step.name] = parsedCached;
          if (i < pipeline.steps.length - 1) {
            const nextStep = pipeline.steps[i + 1] as BaseStep<unknown, unknown>;
            currentInput = pipeline.bridge(
              step,
              nextStep,
              parsedCached,
              validatedInput,
              <T>(name: string) => stepOutputs[name] as T | undefined
            );
          } else {
            currentInput = parsedCached;
          }
          continue;
        }
      }

      // Spec 61.4: pass batchResult into ctx when this is the step being resumed.
      const stepBatchResult =
        options.batchResult?.stepKey === step.name ? options.batchResult : undefined;

      const ctx: StepContext = {
        projectId: options.projectId,
        pipelineRunId: runId,
        stepRunId,
        pipelineName: pipeline.name,
        llmMode,
        runMode,
        ...(stepBatchResult !== undefined ? { batchResult: stepBatchResult } : {}),
        ...(Object.keys(promptOverride).length > 0 ? { promptOverride } : {}),
        log: stepLog,
        reportProgress: async (percent, message) => {
          await db
            .update(pipelineRuns)
            .set({ output: { progress: percent, message } as Record<string, unknown> })
            .where(eq(pipelineRuns.id, stepRunId));
        },
        getStepOutput: <T>(name: string) => stepOutputs[name] as T | undefined,
      };

      // Pattern 102 (Spec 60.7): optional steps declare shouldRun(); skip cleanly when false.
      if (step.shouldRun) {
        const run = await step.shouldRun(ctx);
        if (!run) {
          stepLog.info({ stepIndex: i }, "Step skipped (shouldRun = false)");
          const rawSkip = step.skipOutput ? step.skipOutput(stepInput) : stepInput;
          const validatedSkip = step.outputSchema.parse(rawSkip);
          await db
            .update(pipelineRuns)
            .set({
              status: "completed",
              output: validatedSkip as Record<string, unknown>,
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.id, stepRunId));
          stepOutputs[step.name] = validatedSkip;
          if (i < pipeline.steps.length - 1) {
            const nextStep = pipeline.steps[i + 1] as BaseStep<unknown, unknown>;
            currentInput = pipeline.bridge(
              step,
              nextStep,
              validatedSkip,
              validatedInput,
              ctx.getStepOutput
            );
          } else {
            currentInput = validatedSkip;
          }
          continue;
        }
      }

      lastStepName = step.name;
      const stepStartTime = Date.now();
      let stepOutput: unknown;

      void publishPipelineEvent(options.projectId, {
        type: "pipeline.step.started",
        runId,
        stepRunId,
        stepName: step.name,
        timestamp: new Date().toISOString(),
      });

      try {
        stepOutput = await step.execute(stepInput, ctx);
      } catch (err) {
        // Note: batch suspension MUST NOT use exceptions (Pattern 118) — handled below.
        const errMsg = err instanceof Error ? err.message : String(err);
        await db
          .update(pipelineRuns)
          .set({ status: "failed", errorMessage: errMsg, completedAt: new Date() })
          .where(eq(pipelineRuns.id, stepRunId));
        throw err;
      }

      // Spec 61.4 Pattern 118: detect batch suspension signal BEFORE output schema validation.
      // Step returns { batchPending: true, batchRequestId } when mode === 'batch'.
      if (
        typeof stepOutput === "object" &&
        stepOutput !== null &&
        "batchPending" in stepOutput &&
        (stepOutput as { batchPending: boolean }).batchPending
      ) {
        const suspension = stepOutput as { batchPending: true; batchRequestId: string };
        const checkpoint: SuspensionCheckpoint = {
          kind: "batch",
          stepKey: step.name,
          batchRequestId: suspension.batchRequestId,
          accumulatedOutput: stepOutputs,
        };
        await db
          .update(pipelineRuns)
          .set({
            status: "batch_pending",
            suspensionCheckpoint: checkpoint as unknown as Record<string, unknown>,
            completedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));
        stepLog.info(
          { stepKey: step.name, batchRequestId: suspension.batchRequestId },
          "Pipeline suspended — awaiting Anthropic Batch API result"
        );
        return {
          ok: false,
          suspended: true,
          runId,
          stepKey: step.name,
          batchRequestId: suspension.batchRequestId,
          error: "batch_suspended" as const,
          failedAtStep: "" as const,
          stepOutputs,
        };
      }

      const validatedOutput = step.outputSchema.parse(stepOutput);

      await db
        .update(pipelineRuns)
        .set({
          status: "completed",
          output: validatedOutput as Record<string, unknown>,
          completedAt: new Date(),
        })
        .where(eq(pipelineRuns.id, stepRunId));

      const stepDurationMs = Date.now() - stepStartTime;
      stepLog.info({ durationMs: stepDurationMs }, "Step completed");

      void publishPipelineEvent(options.projectId, {
        type: "pipeline.step.completed",
        runId,
        stepRunId,
        stepName: step.name,
        durationMs: stepDurationMs,
        costEur: 0, // cost_logs are written by adapters asynchronously; step-level cost not available here
        timestamp: new Date().toISOString(),
      });

      stepOutputs[step.name] = validatedOutput;

      // Spec 62.0a: idempotency cache write — best-effort, ON CONFLICT DO NOTHING means
      // the first writer wins; concurrent identical-input runs simply share the cached output.
      if (idemKey) {
        await writeIdempotencyOutput({
          idempotencyKey: idemKey,
          pipelineName: pipeline.name,
          stepName: step.name,
          projectId: options.projectId,
          stepOutput: validatedOutput as Record<string, unknown>,
          // costEur is not measured at the runner level — defaults to 0. Spec 62.0a notes
          // this is an approximation; per-step cost attribution is a Phase 3 concern.
        });
      }

      // Spec 62.0a: debug-mode step-pause. After every pausable step's successful run, suspend
      // the pipeline and persist a step_pauses row for user resolution. Production mode skips
      // this entirely. Steps can opt out via pausableInDebug() → false (trivial persist steps).
      if (runMode === "debug" && step.pausableInDebug()) {
        const pausedAccumulated = { ...stepOutputs };
        const stepPauseRow = await persistStepPause({
          pipelineRunId: runId,
          stepRunId,
          stepName: step.name,
          pipelineName: pipeline.name,
          projectId: options.projectId,
          stepInput: stepInput as Record<string, unknown>,
          stepOutput: validatedOutput as Record<string, unknown>,
          // promptUsed is only populated when the edit-prompt override was applied for THIS step.
          // The full default prompt is reconstructable from buildSystemPrompt() at any time and
          // is not stored to keep the row small. 62.0b will link to prompt_versions instead.
          promptUsed: promptOverride[step.name] ?? null,
        });

        // Reuse the pipeline_runs.suspensionCheckpoint jsonb column for step-pause checkpoints —
        // shape carries a `kind: "step_pause"` discriminator and the step_pauses row id so
        // the resolve service can rebuild PipelineRunOptions.priorOutput.
        const checkpoint: SuspensionCheckpoint = {
          kind: "step_pause",
          stepKey: step.name,
          stepPauseId: stepPauseRow.id,
          accumulatedOutput: pausedAccumulated,
        };
        await db
          .update(pipelineRuns)
          .set({
            status: "paused",
            suspensionCheckpoint: checkpoint as unknown as Record<string, unknown>,
            completedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));

        stepLog.info(
          { stepPauseId: stepPauseRow.id, stepName: step.name },
          "Pipeline suspended — step paused awaiting user resolution"
        );
        // Spec 62.0a Section 7: notify owners (fire-and-forget; helper coalesces per run).
        void notifyStepPaused({
          projectId: options.projectId,
          pipelineRunId: runId,
          pipelineName: pipeline.name,
          stepName: step.name,
          stepPauseId: stepPauseRow.id,
        });
        // Spec 62.6: live-update events so the RunsList + RunDetail UI flip without refresh.
        void publishPipelineEvent(options.projectId, {
          type: "step.paused",
          runId,
          pipelineName: pipeline.name,
          stepName: step.name,
          stepPauseId: stepPauseRow.id,
          stepRunId,
          timestamp: new Date().toISOString(),
        });
        void publishPipelineEvent(options.projectId, {
          type: "run.statusChanged",
          runId,
          pipelineName: pipeline.name,
          oldStatus: "running",
          newStatus: "paused",
          timestamp: new Date().toISOString(),
        });
        return {
          ok: false,
          suspended: true,
          runId,
          stepKey: step.name,
          stepPauseId: stepPauseRow.id,
          error: "step_paused" as const,
          failedAtStep: "" as const,
          stepOutputs: pausedAccumulated,
        };
      }

      if (i < pipeline.steps.length - 1) {
        const nextStep = pipeline.steps[i + 1] as BaseStep<unknown, unknown>;
        currentInput = pipeline.bridge(
          step,
          nextStep,
          validatedOutput,
          validatedInput,
          ctx.getStepOutput
        );
      } else {
        currentInput = validatedOutput;
      }
    }

    const finalOutput = pipeline.outputSchema.parse(currentInput);

    await db
      .update(pipelineRuns)
      .set({
        status: "completed",
        output: finalOutput as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));

    await reportJobProgress?.(100);

    void publishPipelineEvent(options.projectId, {
      type: "pipeline.completed",
      runId,
      pipelineName: pipeline.name,
      totalCostEur: 0, // aggregated cost_logs are queried separately by the detail endpoint
      durationMs: Date.now() - pipelineStartTime,
      timestamp: new Date().toISOString(),
    });

    if (pipeline.afterComplete) {
      // Separate try-catch: afterComplete errors must not re-trigger BullMQ retries that
      // would re-run expensive LLM steps. A warning log leaves the pipeline as "completed"
      // so Marcel can still manually continue via article:continue if needed.
      try {
        await pipeline.afterComplete(finalOutput as TOutput, validatedInput as TInput, runId);
      } catch (afterErr) {
        pipelineLog.warn(
          { err: afterErr },
          "afterComplete hook failed — pipeline output is saved, hook side-effects may be incomplete"
        );
      }
    }

    pipelineLog.info("Pipeline completed");

    return { ok: true, runId, output: finalOutput as TOutput, stepOutputs };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    pipelineLog.error({ err, failedAtStep: lastStepName }, "Pipeline failed");

    void publishPipelineEvent(options.projectId, {
      type: "pipeline.failed",
      runId,
      pipelineName: pipeline.name,
      stepName: lastStepName,
      error: errMsg.slice(0, 500),
      timestamp: new Date().toISOString(),
    });

    await db
      .update(pipelineRuns)
      .set({ status: "failed", errorMessage: errMsg, completedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));

    // Spec 62.0a Section 4.5.2: any unresolved step_pauses on this run are now meaningless —
    // the parent failed and won't resume. Auto-dismiss so they drop out of the unresolved index.
    // Wrapped in try-catch so a DB hiccup here does NOT re-throw out of the parent catch
    // block (which would propagate to BullMQ and trigger an expensive retry).
    try {
      const dismissed = await autoDismissStepPauses(runId, "failed");
      if (dismissed > 0) {
        pipelineLog.info(
          { dismissed },
          "Auto-dismissed unresolved step-pauses on pipeline failure"
        );
      }
    } catch (dismissErr) {
      pipelineLog.warn({ err: dismissErr }, "autoDismissStepPauses failed — stale pauses remain");
    }

    if (pipeline.afterError) {
      try {
        await pipeline.afterError(err, validatedInput as TInput);
      } catch (afterErr) {
        pipelineLog.warn({ err: afterErr }, "afterError hook failed — cleanup may be incomplete");
      }
    }

    return { ok: false, runId, error: errMsg, failedAtStep: lastStepName, stepOutputs };
  }
}
