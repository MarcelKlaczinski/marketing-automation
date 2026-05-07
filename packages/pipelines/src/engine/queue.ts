import { registerQueuePauser } from "@marketing-auto/core/cost";
import { createNotification } from "@marketing-auto/core/notifications";
import { db, pipelineRuns, users } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { type JobsOptions, Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import IORedis from "ioredis";
import { z } from "zod";
import type { Pipeline } from "./pipeline.ts";
import { pipelineRegistry } from "./registry.ts";
import { runPipeline } from "./runner.ts";

const jobDataSchema = z.object({
  pipelineName: z.string(),
  projectId: z.string(),
  input: z.unknown(),
  preRunId: z.string().uuid().optional(),
});

const log = createLogger("pipeline-queue");

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
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 }, // 5s, 10s, 20s
      removeOnComplete: { count: 1000, age: 7 * 24 * 3600 },
      removeOnFail: { count: 1000, age: 30 * 24 * 3600 },
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

export type EnqueuePipelineInput = {
  pipelineName: string;
  projectId: string;
  input: unknown;
  jobOptions?: JobsOptions;
  /** Pre-created pipeline_runs row ID. Runner will UPDATE it instead of INSERT. */
  preRunId?: string;
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
      const { pipelineName, projectId, input, preRunId } = jobDataSchema.parse(job.data);

      const pipeline = pipelineRegistry.get(pipelineName);
      if (!pipeline) {
        throw new Error(`Pipeline not registered: ${pipelineName}`);
      }

      const runOpts: Parameters<typeof runPipeline>[2] =
        preRunId !== undefined
          ? { projectId, jobId: String(job.id), preRunId }
          : { projectId, jobId: String(job.id) };

      const result = await runPipeline(
        pipeline as Pipeline<unknown, unknown>,
        input,
        runOpts,
        async (percent) => {
          await job.updateProgress(percent);
        }
      );

      if (!result.ok) {
        throw new Error(`Pipeline failed at step "${result.failedAtStep}": ${result.error}`);
      }

      return { runId: result.runId, output: result.output };
    },
    {
      connection: getConnection(),
      concurrency,
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
