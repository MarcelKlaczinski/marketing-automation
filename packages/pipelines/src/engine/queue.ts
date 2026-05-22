import { registerQueuePauser } from "@marketing-auto/core/cost";
import { createNotification } from "@marketing-auto/core/notifications";
import { db, pipelineRuns, plannedItems, users } from "@marketing-auto/db";
import {
  emitPlanStatusIfFinalized,
  transitionItemCompleted,
  transitionItemFailed,
  transitionItemInProgress,
} from "../execution/status-publisher.ts";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { type JobsOptions, Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import IORedis from "ioredis";
import { z } from "zod";
import type { Pipeline } from "./pipeline.ts";
import { pipelineRegistry } from "./registry.ts";
import { isPipelineSuspended, runPipeline } from "./runner.ts";

const batchResultSchema = z.object({ stepKey: z.string(), content: z.string() });

const stepActionSchemaJob = z.enum([
  "approve",
  "edit-output",
  "edit-prompt",
  "edit-input",
  "rerun",
  "abort",
  "promote-golden",
  "extract-for-optimization",
  "auto-dismissed",
]);

const stepPauseResumeSchema = z.object({
  stepName: z.string(),
  action: stepActionSchemaJob,
  storedOutput: z.unknown(),
  editedInput: z.unknown().optional(),
  editedOutput: z.unknown().optional(),
  editedPrompt: z.string().optional(),
  stepPauseId: z.string().uuid(),
  // Spec 62.0b: who resolved the pause — threaded through to prompt_versions.created_by
  // when action='promote-golden'. Optional for backward-compat with pre-62.0b job payloads.
  resolvedBy: z.string().optional(),
});

const jobDataSchema = z.object({
  pipelineName: z.string(),
  projectId: z.string(),
  input: z.unknown(),
  preRunId: z.string().uuid().optional(),
  // Spec 61.4: batch resume fields (all optional — only set when re-enqueueing after batch completes)
  resumeFromStep: z.string().optional(),
  batchResult: batchResultSchema.optional(),
  priorOutput: z.record(z.unknown()).optional(),
  // Spec 62.0a: step-pause + run-mode fields (all optional)
  runMode: z.enum(["production", "debug"]).optional(),
  overrideLlmMode: z.enum(["sync", "batch"]).optional(),
  stepPauseResume: stepPauseResumeSchema.optional(),
  promptOverride: z.record(z.string()).optional(),
  stepInputOverride: z.record(z.unknown()).optional(),
});

const log = createLogger("pipeline-queue");

/**
 * Spec 62.8: every planner-dispatched job carries `plannedItemId` inside its
 * `input` payload (see `getPipelineForItem`). The shared worker reads it once
 * to drive the planned_item status flips around runPipeline — see usage below.
 *
 * Returns `null` for non-planner runs so the status-flip block is skipped.
 */
function extractPlannedItemId(input: unknown): string | null {
  if (input === null || typeof input !== "object") return null;
  const v = (input as Record<string, unknown>).plannedItemId;
  return typeof v === "string" ? v : null;
}

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
  });
  return _connection;
}

const QUEUE_NAME = "pipelines";

let _queue: Queue | null = null;
export function getPipelineQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      // IMPORTANT: attempts: 1 — pipeline jobs make paid API calls.
      // Auto-retry would charge the same Anthropic/Replicate call multiple times.
      // To retry a failed run, re-trigger manually via the API endpoint.
      attempts: 1,
      removeOnComplete: { count: 100, age: 7 * 24 * 3600 },
      removeOnFail: { count: 50, age: 30 * 24 * 3600 },
    },
  });

  // Register the cost-enforcement pause/resume callbacks so packages/core can
  // pause BullMQ queues without a circular dependency on packages/pipelines.
  // Single global queue — pausing it is acceptable for the single-tenant setup.
  // Multi-tenant deployments would need per-project queues (out of scope).
  registerQueuePauser(
    async (_projectId: string) => {
      await _queue!.pause();
    },
    async (_projectId: string) => {
      await _queue!.resume();
    }
  );

  return _queue;
}

export type BatchResult = { stepKey: string; content: string };

export type EnqueuePipelineInput = {
  pipelineName: string;
  projectId: string;
  input: unknown;
  jobOptions?: JobsOptions;
  /** Pre-created pipeline_runs row ID. Runner will UPDATE it instead of INSERT. */
  preRunId?: string;
  // Spec 61.4: batch resume — skip completed steps and inject cached LLM content
  resumeFromStep?: string;
  batchResult?: BatchResult;
  priorOutput?: Record<string, unknown>;
  // Spec 62.0a: step-pause + run-mode fields
  runMode?: "production" | "debug";
  overrideLlmMode?: "sync" | "batch";
  stepPauseResume?: z.infer<typeof stepPauseResumeSchema>;
  promptOverride?: Record<string, string>;
  stepInputOverride?: Record<string, unknown>;
};

/**
 * Enqueue a pipeline for async execution.
 * Returns the BullMQ job ID immediately. Caller polls or subscribes for completion.
 */
export async function enqueuePipeline(input: EnqueuePipelineInput): Promise<{ jobId: string }> {
  const job = await getPipelineQueue().add(
    input.pipelineName,
    {
      pipelineName: input.pipelineName,
      projectId: input.projectId,
      input: input.input,
      preRunId: input.preRunId,
      ...(input.resumeFromStep !== undefined ? { resumeFromStep: input.resumeFromStep } : {}),
      ...(input.batchResult !== undefined ? { batchResult: input.batchResult } : {}),
      ...(input.priorOutput !== undefined ? { priorOutput: input.priorOutput } : {}),
      ...(input.runMode !== undefined ? { runMode: input.runMode } : {}),
      ...(input.overrideLlmMode !== undefined ? { overrideLlmMode: input.overrideLlmMode } : {}),
      ...(input.stepPauseResume !== undefined ? { stepPauseResume: input.stepPauseResume } : {}),
      ...(input.promptOverride !== undefined ? { promptOverride: input.promptOverride } : {}),
      ...(input.stepInputOverride !== undefined
        ? { stepInputOverride: input.stepInputOverride }
        : {}),
    },
    input.jobOptions
  );
  return { jobId: String(job.id) };
}

/**
 * Starts the worker process that consumes jobs from the queue.
 * Call this from a separate process (apps/api/src/workers/index.ts).
 *
 * The worker uses pipelineRegistry to look up pipelines by name and execute them.
 */
export function startPipelineWorker(opts?: { concurrency?: number }): Worker {
  const concurrency = opts?.concurrency ?? 5;

  // Ensure queue is initialized and queue pauser registered (needed when this
  // process never calls enqueuePipeline, e.g. a dedicated worker-only process).
  getPipelineQueue();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const {
        pipelineName,
        projectId,
        input,
        preRunId,
        resumeFromStep,
        batchResult,
        priorOutput,
        runMode,
        overrideLlmMode,
        stepPauseResume,
        promptOverride,
        stepInputOverride,
      } = jobDataSchema.parse(job.data);

      const pipeline = pipelineRegistry.get(pipelineName);
      if (!pipeline) {
        throw new Error(`Pipeline not registered: ${pipelineName}`);
      }

      // Spec 62.8: when the pipeline input carries a `plannedItemId`, the run
      // is part of a planner-driven plan-execution pass. We flip the row
      // enqueued → in_progress before runPipeline and finalize completed /
      // failed below — centralised here so every content pipeline picks the
      // hooks up without per-pipeline afterComplete wiring.
      const plannedItemId = extractPlannedItemId(input);
      let plannedItemPlanId: string | null = null;
      if (plannedItemId !== null) {
        const [row] = await db
          .select({ weeklyPlanId: plannedItems.weeklyPlanId })
          .from(plannedItems)
          .where(eq(plannedItems.id, plannedItemId))
          .limit(1);
        plannedItemPlanId = row?.weeklyPlanId ?? null;
        if (plannedItemPlanId === null) {
          log.warn(
            { plannedItemId, pipelineName, jobId: String(job.id) },
            "planned_item referenced by job payload not found — skipping status hooks",
          );
        } else {
          await transitionItemInProgress({
            projectId,
            planId: plannedItemPlanId,
            itemId: plannedItemId,
          });
        }
      }

      // Zod's z.string().optional() infers as `string | undefined`; the runner's
      // StepPauseResume interface uses `editedPrompt?: string` (exactOptionalPropertyTypes).
      // The cast resolves the variance — runtime values are equivalent.
      const runOpts = {
        projectId,
        jobId: String(job.id),
        ...(preRunId !== undefined ? { preRunId } : {}),
        ...(resumeFromStep !== undefined ? { resumeFromStep } : {}),
        ...(batchResult !== undefined ? { batchResult } : {}),
        ...(priorOutput !== undefined ? { priorOutput } : {}),
        ...(runMode !== undefined ? { runMode } : {}),
        ...(overrideLlmMode !== undefined ? { overrideLlmMode } : {}),
        ...(stepPauseResume !== undefined ? { stepPauseResume } : {}),
        ...(promptOverride !== undefined ? { promptOverride } : {}),
        ...(stepInputOverride !== undefined ? { stepInputOverride } : {}),
      } as Parameters<typeof runPipeline>[2];

      let result: Awaited<ReturnType<typeof runPipeline>>;
      try {
        result = await runPipeline(
          pipeline as Pipeline<unknown, unknown>,
          input,
          runOpts,
          async (percent) => {
            await job.updateProgress(percent);
          }
        );
      } catch (err) {
        // Spec 62.8: surface mid-run throws to the planned_item as 'failed' so
        // the planner UI doesn't show forever-in-progress rows when the
        // pipeline crashes outside the runner's normal error path.
        if (plannedItemId !== null && plannedItemPlanId !== null) {
          const reason = err instanceof Error ? err.message : "pipeline threw";
          await transitionItemFailed({
            projectId,
            planId: plannedItemPlanId,
            itemId: plannedItemId,
            reason,
          }).catch(() => false);
        }
        throw err;
      }

      // Spec 61.4: batch suspension — BullMQ job completes cleanly, processor resumes later.
      // Planned-item status remains 'in_progress' across the suspension; the
      // resumed run will land here again on completion.
      if (isPipelineSuspended(result)) {
        return { runId: result.runId, output: null };
      }

      // Spec 62.8: finalize planned_item status before re-throwing on failure
      // so the row reflects the failure even though we let BullMQ see the
      // throw (downstream notifications + on('failed') handler still fire).
      if (plannedItemId !== null && plannedItemPlanId !== null) {
        if (result.ok) {
          await transitionItemCompleted({
            projectId,
            planId: plannedItemPlanId,
            itemId: plannedItemId,
          });
        } else {
          await transitionItemFailed({
            projectId,
            planId: plannedItemPlanId,
            itemId: plannedItemId,
            reason: `failed at step "${result.failedAtStep}": ${result.error}`,
          });
        }
        // transitionItemCompleted / transitionItemFailed already finalize plan
        // status on the inner emit — but call once more here as a belt-and-
        // suspenders fallback in case the inner emit was skipped (e.g. when
        // the item was already in a terminal state from a prior retry).
        await emitPlanStatusIfFinalized(projectId, plannedItemPlanId).catch(() => undefined);
      }

      // Runner returns this when the project was deleted between enqueue and pickup.
      // No pipeline_runs row was inserted, no work to settle — treat as a clean
      // job completion so BullMQ doesn't emit a failure notification.
      if (!result.ok && result.error === "project_deleted") {
        log.info(
          { pipelineName, projectId, jobId: String(job.id) },
          "BullMQ job completed as no-op: project deleted before worker pickup"
        );
        return { runId: "", output: null, skipped: "project_deleted" };
      }

      if (!result.ok) {
        throw new Error(`Pipeline failed at step "${result.failedAtStep}": ${result.error}`);
      }

      return { runId: result.runId, output: result.output };
    },
    {
      connection: getConnection(),
      concurrency,
      // LLM pipeline jobs can take 5–15 minutes. BullMQ default lockDuration is 30s,
      // renewed every 15s. Set to 10 min so a slow event loop never causes a false stall.
      // stalledInterval must be > lockDuration to avoid the worker fighting itself.
      lockDuration: 10 * 60 * 1000, // 10 minutes
      stalledInterval: 15 * 60 * 1000, // check for stalled jobs every 15 minutes
      maxStalledCount: 0, // no auto-retry on stall — avoids duplicate paid API calls
    }
  );

  const MEANINGFUL_PIPELINES = new Set([
    "article:outline",
    "article:draft",
    "article:sync",
    "cold-start:cluster-plan",
    "cold-start:cornerstone-spec",
  ]);

  const PIPELINE_TITLES: Record<string, string> = {
    "article:outline": "Outline complete",
    "article:draft": "Draft complete",
    "article:sync": "Astro-Sync complete",
    "cold-start:cluster-plan": "Cluster plan complete",
    "cold-start:cornerstone-spec": "Cornerstone spec complete",
  };

  worker.on("ready", () => log.info({ concurrency }, "Pipeline worker started"));

  worker.on("completed", async (job) => {
    log.info({ jobId: job.id, name: job.name }, "Job completed");

    const pipelineName = String(job.data?.pipelineName ?? "");
    const projectId = String(job.data?.projectId ?? "");
    if (!MEANINGFUL_PIPELINES.has(pipelineName) || !projectId) return;

    const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));
    const articleId = job.data?.articleId as string | undefined;
    const link = articleId ? `/articles/${articleId}` : "/activity";

    for (const owner of owners) {
      void createNotification({
        userId: owner.id,
        type: "pipeline_completion",
        severity: "info",
        title: PIPELINE_TITLES[pipelineName] ?? "Pipeline complete",
        message: `${pipelineName} completed successfully.`,
        link,
        metadata: { pipelineName, articleId },
      }).catch((e: unknown) => log.warn({ err: e }, "Failed to create completion notification"));
    }
  });

  worker.on("failed", async (job, err) => {
    log.error({ jobId: job?.id, err }, "Job failed");

    // Tag cost-limit failures so the frontend can show a special error UI
    const isCostError =
      (err as { name?: string }).name === "CostLimitExceededError" ||
      (err.message?.startsWith("cost_limit_exceeded:") ?? false);

    if (isCostError && job?.data?.preRunId) {
      // pipelineRuns.output is $type<Record<string,unknown>>; literal needs cast to match
      const costOutput: Record<string, unknown> = { errorType: "cost_limit_exceeded" };
      await db
        .update(pipelineRuns)
        .set({ output: costOutput })
        .where(eq(pipelineRuns.id, String(job.data.preRunId)))
        .catch((updateErr: unknown) => {
          log.warn({ err: updateErr }, "Failed to tag cost error on pipeline_run");
        });
    }

    // Skip cost-limit failures — already covered by the pause notification in pause.ts
    if (isCostError) return;

    const projectId = String(job?.data?.projectId ?? "");
    if (!projectId) return;

    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"))
      .catch(() => [] as { id: string }[]);

    const pipelineName = String(job?.data?.pipelineName ?? "");
    const articleId = job?.data?.articleId as string | undefined;
    const link = articleId ? `/articles/${articleId}` : "/activity";

    for (const owner of owners) {
      void createNotification({
        userId: owner.id,
        type: "pipeline_failure",
        severity: "critical",
        title: "Pipeline failed",
        message: `${pipelineName || "Pipeline"}: ${(err.message ?? "Unknown error").slice(0, 200)}`,
        link,
        metadata: { pipelineName, articleId, error: err.message },
      }).catch((e: unknown) => log.warn({ err: e }, "Failed to create failure notification"));
    }
  });

  return worker;
}

/** Graceful shutdown: close queue and Redis connection. */
export async function closePipelineInfrastructure(): Promise<void> {
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
