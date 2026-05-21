// Spec 62.8: BullMQ queue + enqueue helper for plan-execution.
//
// The queue carries one job per approved plan. The job's only payload is the
// `planId`; the worker (apps/api/src/workers/plan-execution.worker.ts) reads
// the plan + its planned_items rows directly from the DB. This keeps the job
// data small and lets the worker pick up exactly the current state of the
// plan (e.g. if Marcel cancelled an item between approve and dispatch).
//
// concurrency: 1 — at most one plan-execution per project runs at a time.
// Multiple approve clicks for the same planId dedupe on the deterministic
// jobId. Approving a *different* plan while one is mid-dispatch waits in the
// BullMQ queue and runs next; that's acceptable (each plan iteration is
// short-lived for non-cluster items because BullMQ dispatch is fire-and-forget).

import { Queue } from "bullmq";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("pipelines:plan-execution-queue");

export type PlanExecutionJobData = {
  planId: string;
  /** Email or "system" — used in logs and pipeline-runs audit. */
  triggeredBy?: string;
};

export type PlanExecutionJobResult = {
  planId: string;
  enqueued: number;
  inlineCompleted: number;
  inlineFailed: number;
  blocked: number;
  /** When blocked > 0, the reason that fired (currently always 'budget_gate'). */
  blockReason: string | null;
};

const QUEUE_NAME = "plan-execution";

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue<PlanExecutionJobData, PlanExecutionJobResult> | null = null;
export function getPlanExecutionQueue(): Queue<PlanExecutionJobData, PlanExecutionJobResult> {
  if (_queue) return _queue;
  _queue = new Queue<PlanExecutionJobData, PlanExecutionJobResult>(QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      // No retries on the fan-out job itself — the dispatch loop is idempotent
      // (items with status != 'pending' are skipped) so the safe default is a
      // single attempt. Per-item retries belong to the BullMQ jobs of the
      // downstream content pipelines.
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  return _queue;
}

/**
 * Enqueue a plan-execution job. Idempotent — multiple approve clicks for the
 * same plan dedupe on the deterministic jobId.
 */
export async function enqueuePlanExecution(
  data: PlanExecutionJobData,
): Promise<{ jobId: string }> {
  const queue = getPlanExecutionQueue();
  const jobId = `plan-exec-${data.planId}`;
  const job = await queue.add("execute", data, { jobId });
  log.info({ planId: data.planId, jobId: job.id }, "plan-execution enqueued");
  return { jobId: String(job.id) };
}

export const PLAN_EXECUTION_QUEUE_NAME = QUEUE_NAME;
