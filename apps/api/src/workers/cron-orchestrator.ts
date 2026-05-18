import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { db, eq, cronState } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { getTrendSynthesizerQueue } from "./trend-synthesizer.ts";
import { getRefreshDetectorQueue } from "./refresh-detector.ts";
import { getArticleQualityAnalysisQueue } from "@marketing-auto/pipelines/article-quality-analysis-queue";

const log = createLogger("cron-orchestrator");

const ORCHESTRATOR_QUEUE = "cron-orchestrator";

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getCronOrchestratorQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(ORCHESTRATOR_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    },
  });
  return _queue;
}

// ─── Queue registry ───────────────────────────────────────────────────────────

function getQueueForJobType(jobType: "trends_synthesizer" | "refresh_detector" | "quality_analysis"): Queue {
  if (jobType === "trends_synthesizer") return getTrendSynthesizerQueue();
  if (jobType === "quality_analysis") return getArticleQualityAnalysisQueue();
  return getRefreshDetectorQueue();
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

export async function syncCronJobs(): Promise<void> {
  const desired = await db.select().from(cronState).where(eq(cronState.isActive, true));

  for (const job of desired) {
    const queue = getQueueForJobType(job.jobType);
    const existing = await queue.getRepeatableJobs();
    const jobName = `${job.jobType}:${job.projectId}`;
    const found = existing.find((r) => r.name === jobName);

    if (!found || found.pattern !== job.cronPattern) {
      if (found) {
        await queue.removeRepeatableByKey(found.key);
        log.info({ jobName, pattern: job.cronPattern }, "Removed stale repeating job");
      }
      await queue.add(
        jobName,
        { projectId: job.projectId, type: "cron-triggered" },
        { repeat: { pattern: job.cronPattern } }
      );
      log.info({ jobName, pattern: job.cronPattern }, "Registered repeating job");
    }
  }

  // Remove jobs that are no longer in desired state
  const desiredNames = new Set(desired.map((d) => `${d.jobType}:${d.projectId}`));
  const allQueues = [getTrendSynthesizerQueue(), getRefreshDetectorQueue(), getArticleQualityAnalysisQueue()];

  for (const queue of allQueues) {
    const repeats = await queue.getRepeatableJobs();
    for (const repeat of repeats) {
      const isCronOrchestrated =
        repeat.name.startsWith("trends_synthesizer:") ||
        repeat.name.startsWith("refresh_detector:") ||
        repeat.name.startsWith("quality_analysis:");
      if (isCronOrchestrated && !desiredNames.has(repeat.name)) {
        await queue.removeRepeatableByKey(repeat.key);
        log.info({ name: repeat.name }, "Removed orphaned repeating job");
      }
    }
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startCronOrchestratorWorker() {
  return new Worker(
    ORCHESTRATOR_QUEUE,
    async (_job: Job) => {
      await syncCronJobs();
    },
    { connection: getConnection(), concurrency: 1 }
  );
}

// ─── Register orchestrator tick (every minute) ────────────────────────────────

export async function registerCronOrchestrator(): Promise<void> {
  const queue = getCronOrchestratorQueue();

  // Remove any existing orchestrator repeatable so we don't double-register
  const existing = await queue.getRepeatableJobs();
  for (const r of existing) {
    if (r.name === "sync-cron-state") {
      await queue.removeRepeatableByKey(r.key);
    }
  }

  await queue.add(
    "sync-cron-state",
    {},
    { repeat: { pattern: "* * * * *" }, removeOnComplete: true }
  );
  log.info("Cron orchestrator registered (every minute)");
}
