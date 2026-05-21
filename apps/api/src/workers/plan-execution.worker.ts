// Spec 62.8: BullMQ worker that dispatches an approved weekly plan.
//
// One job per `(planId)` — when Marcel approves a plan via PATCH, the route
// enqueues `{ planId }` here with a deterministic jobId so multiple approve
// clicks dedup. The worker calls `executePlan(planId)` which iterates pending
// items, honours the 90% budget gate, and routes each item to the matching
// content-pipeline queue (or runs cluster:full-plan inline). Idempotent —
// re-runs skip items already past 'pending'.
//
// concurrency: 1 — multiple plans for the same project are serialized so the
// budget gate is not crossed by concurrent dispatch races. (BullMQ ensures
// plans for *different* projects can interleave because the worker is shared
// across all projects — only same-(plan) dedup is in scope.)

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { executePlan } from "@marketing-auto/pipelines/execute-plan";
import {
  getPlanExecutionQueue,
  PLAN_EXECUTION_QUEUE_NAME,
  type PlanExecutionJobData,
} from "@marketing-auto/pipelines/plan-execution-queue";

const log = createLogger("workers:plan-execution");

const jobSchema = z.object({
  planId: z.string().uuid(),
  triggeredBy: z.string().optional(),
});

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

export function startPlanExecutionWorker(): Worker {
  // Initialize the queue too — registers Redis connection + default options.
  getPlanExecutionQueue();
  return new Worker(
    PLAN_EXECUTION_QUEUE_NAME,
    async (job: Job<PlanExecutionJobData>) => {
      const data = jobSchema.parse(job.data);
      log.info({ planId: data.planId, jobId: job.id }, "plan-execution job started");
      const result = await executePlan(data.planId);
      log.info({ ...result }, "plan-execution job completed");
      return result;
    },
    {
      connection: getConnection(),
      concurrency: 1,
    },
  );
}
