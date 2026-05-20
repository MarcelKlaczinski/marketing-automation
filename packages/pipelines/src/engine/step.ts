import type { Logger } from "@marketing-auto/shared";
import type { z } from "zod";

/**
 * Context passed to every step's execute() method.
 * Contains the runtime info a step needs to do its work and stay traceable.
 */
export type StepContext = {
  /** Project (tenant) executing the pipeline */
  projectId: string;
  /** ID of the parent pipeline_runs row (for cost-log linking) */
  pipelineRunId: string;
  /**
   * LLM execution mode for this pipeline run (Spec 61.4).
   * 'sync' = immediate LLM call (default). 'batch' = Anthropic Batch API (50% cost, 24h delay).
   * Steps that call LLMs must check this and return batchPending: true when mode === 'batch'.
   */
  llmMode: "sync" | "batch";
  /**
   * Spec 61.4: cached LLM content injected by the batch resume path.
   * Present only for the step named batchResult.stepKey on pipeline resume.
   * Steps that call LLMs must check this first and bypass the actual LLM call.
   */
  batchResult?: { stepKey: string; content: string };
  /**
   * Spec 62.0a: pipeline execution mode.
   * 'production' (default): runner executes every step end-to-end.
   * 'debug': after each pausable step's successful execute(), the runner persists a
   * step_pauses row and suspends the pipeline (status='paused'). The user resolves
   * the pause via POST /pipeline-runs/:id/step-pauses/:id/resolve, which re-enqueues
   * with PipelineRunOptions.stepPauseResume populated.
   */
  runMode: "production" | "debug";
  /**
   * Spec 62.0a: per-step prompt override populated by the 'edit-prompt' resume action.
   * LLM steps must consume via `resolvePrompt(ctx, this.name, () => buildSystemPrompt(...))`
   * from `@marketing-auto/pipelines/prompt-resolver`. Keyed by step.name so a pipeline
   * with multiple LLM steps (e.g. BlogPipeline.Outline + .Draft) does not collide.
   */
  promptOverride?: Record<string, string>;
  /** ID of this step's pipeline_runs row (sub-run of the pipeline run) */
  stepRunId: string;
  /** Pipeline name for logging */
  pipelineName: string;
  /** Logger pre-bound with run context */
  log: Logger;
  /**
   * Reports progress (0-100). Surfaces in BullMQ progress for UI.
   * Optional but encouraged for slow steps.
   */
  reportProgress: (percent: number, message?: string) => Promise<void>;
  /**
   * Read state from a previous step's output (by step name).
   * Useful when step N+2 needs step N's output.
   */
  getStepOutput: <T = unknown>(stepName: string) => T | undefined;
};

/**
 * Base contract for a pipeline step.
 *
 * Steps MUST be idempotent: re-running with the same input produces the same output.
 * Steps SHOULD compute idempotencyKey() to enable skip-on-rerun.
 */
export abstract class BaseStep<TInput, TOutput> {
  /** Unique step name within a pipeline (also used as BullMQ progress label) */
  abstract readonly name: string;

  /** Optional human-readable description for logs/UI */
  readonly description?: string;

  /** Zod schema for input validation. Validated before execute(). */
  abstract readonly inputSchema: z.ZodType<TInput>;

  /** Zod schema for output validation. Validated after execute(). */
  abstract readonly outputSchema: z.ZodType<TOutput>;

  /**
   * Performs the step's work.
   * Throws on unrecoverable error (will propagate to BullMQ for retry).
   * Returns output that will be validated against outputSchema.
   */
  abstract execute(input: TInput, ctx: StepContext): Promise<TOutput>;

  /**
   * Returns an idempotency key for this step+input combination.
   * If the same key was completed in a previous (failed) run of the SAME pipeline_run,
   * the step's previous output is reused and execute() is skipped.
   *
   * Default: null (no idempotency optimization, always re-run).
   * Override when re-execution is expensive (LLM calls, image generation).
   */
  idempotencyKey(_input: TInput): string | null {
    return null;
  }

  /**
   * Estimated max cost in EUR. Used by cost-tracker for pre-flight limit check.
   * Default: 0 (steps that don't call paid APIs).
   * Override for paid steps (LLM, image gen, etc.).
   */
  estimatedCostEur(_input: TInput): number {
    return 0;
  }

  /**
   * Optional guard for optional pipeline steps (Pattern 102, Spec 60.7).
   * When defined and returns false, the step is skipped (execute() is not called).
   * The runner calls skipOutput() to determine the skipped step's output.
   * Default: undefined (step always runs).
   */
  shouldRun?(ctx: StepContext): Promise<boolean>;

  /**
   * Returns the output to use when the step is skipped via shouldRun() → false.
   * Must be a valid instance of TOutput (will be parsed through outputSchema).
   * Required when shouldRun() is defined.
   */
  skipOutput?(_input: TInput): TOutput;

  /**
   * Spec 62.0a: whether this step is pausable in debug mode.
   * Default: true. Override to false for trivial steps (DB persist, status updates)
   * where pausing adds no inspection value. Production-mode runs ignore this entirely.
   */
  pausableInDebug(): boolean {
    return true;
  }
}
