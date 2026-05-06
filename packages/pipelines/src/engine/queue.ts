import { Queue, Worker, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { runPipeline } from "./runner.ts";
import type { Pipeline } from "./pipeline.ts";
import { pipelineRegistry } from "./registry.ts";

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
    input.jobOptions,
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

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { pipelineName, projectId, input, preRunId } = jobDataSchema.parse(job.data);

      const pipeline = pipelineRegistry.get(pipelineName);
      if (!pipeline) {
        throw new Error(`Pipeline not registered: ${pipelineName}`);
      }

      const result = await runPipeline(
        pipeline as Pipeline<unknown, unknown>,
        input,
        { projectId, jobId: String(job.id), preRunId },
        async (percent) => {
          await job.updateProgress(percent);
        },
      );

      if (!result.ok) {
        throw new Error(`Pipeline failed at step "${result.failedAtStep}": ${result.error}`);
      }

      return { runId: result.runId, output: result.output };
    },
    {
      connection: getConnection(),
      concurrency,
    },
  );

  worker.on("ready", () => log.info({ concurrency }, "Pipeline worker started"));
  worker.on("completed", (job) => log.info({ jobId: job.id, name: job.name }, "Job completed"));
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "Job failed"));

  return worker;
}

/** Graceful shutdown: close queue and Redis connection. */
export async function closePipelineInfrastructure(): Promise<void> {
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
