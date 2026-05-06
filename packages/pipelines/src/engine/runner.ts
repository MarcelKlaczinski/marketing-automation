import { eq } from "drizzle-orm";
import { db, pipelineRuns } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { BaseStep, StepContext } from "./step.ts";
import type { Pipeline } from "./pipeline.ts";

const log = createLogger("pipeline-runner");

export type PipelineRunOptions = {
  projectId: string;
  parentRunId?: string;
  /** BullMQ job ID for correlation */
  jobId?: string;
};

export type PipelineRunResult<TOutput> =
  | { ok: true; runId: string; output: TOutput; stepOutputs: Record<string, unknown> }
  | { ok: false; runId: string; error: string; failedAtStep: string; stepOutputs: Record<string, unknown> };

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
  reportJobProgress?: (percent: number) => Promise<void>,
): Promise<PipelineRunResult<TOutput>> {
  const validatedInput = pipeline.inputSchema.parse(input);

  const [parentRun] = await db.insert(pipelineRuns).values({
    projectId: options.projectId,
    pipelineName: pipeline.name,
    stepName: null,
    status: "running",
    jobId: options.jobId ?? null,
    parentRunId: options.parentRunId ?? null,
    input: validatedInput as Record<string, unknown>,
    startedAt: new Date(),
  }).returning({ id: pipelineRuns.id });

  const runId = parentRun!.id;
  const pipelineLog = log.child({ runId, pipeline: pipeline.name, projectId: options.projectId });
  pipelineLog.info({ stepCount: pipeline.steps.length }, "Pipeline started");

  const stepOutputs: Record<string, unknown> = {};
  let currentInput: unknown = validatedInput;
  let lastStepName = "(none)";

  try {
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i] as BaseStep<unknown, unknown>;
      const overallProgress = Math.round((i / pipeline.steps.length) * 100);
      await reportJobProgress?.(overallProgress);

      const stepLog = pipelineLog.child({ step: step.name });
      stepLog.info({ stepIndex: i }, "Step starting");

      const stepInput = step.inputSchema.parse(currentInput);

      const [stepRun] = await db.insert(pipelineRuns).values({
        projectId: options.projectId,
        pipelineName: pipeline.name,
        stepName: step.name,
        status: "running",
        parentRunId: runId,
        input: stepInput as Record<string, unknown>,
        startedAt: new Date(),
      }).returning({ id: pipelineRuns.id });

      const stepRunId = stepRun!.id;

      const idemKey = step.idempotencyKey(stepInput);
      if (idemKey) stepLog.debug({ idemKey }, "Idempotency key computed (caching not yet implemented)");

      const ctx: StepContext = {
        projectId: options.projectId,
        pipelineRunId: runId,
        stepRunId,
        pipelineName: pipeline.name,
        log: stepLog,
        reportProgress: async (percent, message) => {
          await db.update(pipelineRuns)
            .set({ output: { progress: percent, message } as Record<string, unknown> })
            .where(eq(pipelineRuns.id, stepRunId));
        },
        getStepOutput: <T>(name: string) => stepOutputs[name] as T | undefined,
      };

      lastStepName = step.name;
      const stepStartTime = Date.now();
      let stepOutput: unknown;

      try {
        stepOutput = await step.execute(stepInput, ctx);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await db.update(pipelineRuns)
          .set({ status: "failed", errorMessage: errMsg, completedAt: new Date() })
          .where(eq(pipelineRuns.id, stepRunId));
        throw err;
      }

      const validatedOutput = step.outputSchema.parse(stepOutput);

      await db.update(pipelineRuns)
        .set({ status: "completed", output: validatedOutput as Record<string, unknown>, completedAt: new Date() })
        .where(eq(pipelineRuns.id, stepRunId));

      stepLog.info({ durationMs: Date.now() - stepStartTime }, "Step completed");
      stepOutputs[step.name] = validatedOutput;

      if (i < pipeline.steps.length - 1) {
        const nextStep = pipeline.steps[i + 1] as BaseStep<unknown, unknown>;
        currentInput = pipeline.bridge(step, nextStep, validatedOutput, validatedInput, ctx.getStepOutput);
      } else {
        currentInput = validatedOutput;
      }
    }

    const finalOutput = pipeline.outputSchema.parse(currentInput);

    await db.update(pipelineRuns)
      .set({ status: "completed", output: finalOutput as Record<string, unknown>, completedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));

    await reportJobProgress?.(100);

    if (pipeline.afterComplete) {
      // Separate try-catch: afterComplete errors must not re-trigger BullMQ retries that
      // would re-run expensive LLM steps. A warning log leaves the pipeline as "completed"
      // so Marcel can still manually continue via article:continue if needed.
      try {
        await pipeline.afterComplete(finalOutput as TOutput, validatedInput as TInput);
      } catch (afterErr) {
        pipelineLog.warn({ err: afterErr }, "afterComplete hook failed — pipeline output is saved, hook side-effects may be incomplete");
      }
    }

    pipelineLog.info("Pipeline completed");

    return { ok: true, runId, output: finalOutput as TOutput, stepOutputs };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    pipelineLog.error({ err, failedAtStep: lastStepName }, "Pipeline failed");

    await db.update(pipelineRuns)
      .set({ status: "failed", errorMessage: errMsg, completedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));

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
