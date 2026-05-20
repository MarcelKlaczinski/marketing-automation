// Spec 60.7: enqueue helper for template-render jobs from within pipeline steps.
// Intentionally lives in packages/pipelines so SocialGenerationStep can call it directly.
// The discovery worker (apps/api/src/workers/discoveryWorker.ts) consumes jobs from the
// same "discovery" queue — no new worker needed.
import { Queue } from "bullmq";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("pipelines:template-render-queue");

const DISCOVERY_QUEUE_NAME = "discovery";

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  return _connection;
}

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(DISCOVERY_QUEUE_NAME, { connection: getConnection() });
  return _queue;
}

export async function enqueueTemplateRenderFromStep(
  templateRenderId: string,
): Promise<{ jobId: string }> {
  const queue = getQueue();
  const job = await queue.add(
    "render-template",
    { type: "render-template", templateRenderId },
    { jobId: `render-template-${templateRenderId}` },
  );
  log.debug({ templateRenderId, jobId: job.id }, "Template render job enqueued from step");
  return { jobId: job.id ?? `render-template-${templateRenderId}` };
}
