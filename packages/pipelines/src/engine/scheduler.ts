import { Queue, Worker } from "bullmq";
import { getEnv, createLogger } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("scheduler");

const SCHEDULER_QUEUE = "scheduled";

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
function getSchedulerQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(SCHEDULER_QUEUE, { connection: getConnection() });
  return _queue;
}

type ScheduledJob = {
  name: string;
  cron: string;
  handler: () => Promise<void>;
};

const scheduledJobs = new Map<string, ScheduledJob>();

/**
 * Register a scheduled job. Call at startup, BEFORE startScheduler().
 */
export function registerScheduledJob(job: ScheduledJob): void {
  scheduledJobs.set(job.name, job);
}

/**
 * Starts the scheduler: schedules all registered jobs, starts a worker to execute them.
 * Idempotent — calling twice is safe (BullMQ deduplicates by job key).
 */
export async function startScheduler(): Promise<Worker> {
  const queue = getSchedulerQueue();

  for (const [name, job] of scheduledJobs) {
    await queue.add(
      name,
      {},
      {
        repeat: { pattern: job.cron },
        jobId: `scheduled:${name}`,
      },
    );
    log.info({ name, cron: job.cron }, "Scheduled job registered");
  }

  const worker = new Worker(
    SCHEDULER_QUEUE,
    async (job) => {
      const sj = scheduledJobs.get(job.name);
      if (!sj) {
        log.warn({ name: job.name }, "No handler registered for scheduled job");
        return;
      }
      log.info({ name: job.name }, "Scheduled job starting");
      await sj.handler();
      log.info({ name: job.name }, "Scheduled job completed");
    },
    { connection: getConnection() },
  );

  worker.on("failed", (job, err) => log.error({ name: job?.name, err }, "Scheduled job failed"));

  return worker;
}
