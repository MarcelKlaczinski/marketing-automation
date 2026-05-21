import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import {
  and,
  cronJobTypeEnum,
  cronState,
  db,
  desc,
  eq,
  externalSignals,
  type ExternalSignalSource,
} from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { getTrendSynthesizerQueue } from "./trend-synthesizer.ts";
import { getRefreshDetectorQueue } from "./refresh-detector.ts";
import { getArticleQualityAnalysisQueue } from "@marketing-auto/pipelines/article-quality-analysis-queue";
import { getSignalCollectorQueue } from "./signal-collector.ts";
import { getStepPauseCleanupQueue } from "./step-pause-cleanup.worker.ts";
import { getPlannerWeeklyGenerationQueue } from "./planner-weekly-generation.worker.ts";

const log = createLogger("cron-orchestrator");

// Map cron_state.job_type → external_signals.source. Used by the startup
// catch-up to translate scheduler-side identifiers into the adapter source
// name we filter `external_signals` by. Typed against the cron_job_type pg
// enum so adding a new signal_collector_* enum value forces an update here.
type CronJobType = (typeof cronJobTypeEnum.enumValues)[number];
type SignalCollectorJobType = Extract<CronJobType, `signal_collector_${string}`>;

const SIGNAL_COLLECTOR_JOB_TYPE_TO_SOURCE: Record<SignalCollectorJobType, ExternalSignalSource> = {
  signal_collector_producthunt: "producthunt",
  signal_collector_hackernews:  "hackernews",
  signal_collector_vendor_rss:  "vendor_rss",
  signal_collector_reddit:      "reddit",
  signal_collector_github:      "github",
};

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

function getQueueForJobType(jobType: CronJobType): Queue {
  if (jobType === "trends_synthesizer") return getTrendSynthesizerQueue();
  if (jobType === "quality_analysis") return getArticleQualityAnalysisQueue();
  if (jobType === "signal_collector_reddit") return getSignalCollectorQueue();
  if (jobType === "signal_collector_github") return getSignalCollectorQueue();
  if (jobType === "signal_collector_hackernews") return getSignalCollectorQueue();
  if (jobType === "signal_collector_producthunt") return getSignalCollectorQueue();
  if (jobType === "signal_collector_vendor_rss") return getSignalCollectorQueue();
  if (jobType === "step_pause_cleanup") return getStepPauseCleanupQueue();
  if (jobType === "planner_weekly_generation") return getPlannerWeeklyGenerationQueue();
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
  const allQueues = [
    getTrendSynthesizerQueue(),
    getRefreshDetectorQueue(),
    getArticleQualityAnalysisQueue(),
    getSignalCollectorQueue(),
    getStepPauseCleanupQueue(),
    getPlannerWeeklyGenerationQueue(),
  ];

  for (const queue of allQueues) {
    const repeats = await queue.getRepeatableJobs();
    for (const repeat of repeats) {
      const isCronOrchestrated =
        repeat.name.startsWith("trends_synthesizer:") ||
        repeat.name.startsWith("refresh_detector:") ||
        repeat.name.startsWith("quality_analysis:") ||
        repeat.name.startsWith("signal_collector_reddit:") ||
        repeat.name.startsWith("signal_collector_github:") ||
        repeat.name.startsWith("signal_collector_hackernews:") ||
        repeat.name.startsWith("signal_collector_producthunt:") ||
        repeat.name.startsWith("signal_collector_vendor_rss:") ||
        repeat.name.startsWith("step_pause_cleanup:") ||
        repeat.name.startsWith("planner_weekly_generation:");
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

// ─── Signal-collector startup catch-up ────────────────────────────────────────
//
// BullMQ repeating jobs are silently dropped when the worker isn't running at
// the scheduled minute — there is no backfire. For per-project daily signal
// crons (00:30 Berlin etc.) that means an offline overnight worker means no
// collection for the day. This catch-up runs once on orchestrator startup and
// enqueues a one-off `collect-adapter` for any active signal_collector_* row
// whose last successful collection in `external_signals` is older than 24h.
//
// Idempotency:
//   - deterministic per-day jobId — multiple worker restarts in the same UTC
//     day add the job once
//   - "fresh collection in last 24h" guard — avoids double-firing right after
//     the scheduled cron actually ran
//   - underlying INSERT uses onConflictDoNothing on (source, external_id) so
//     even if a catch-up overlaps with a manual trigger, no duplicate rows.
async function catchUpStaleSignalCollectors(): Promise<void> {
  const active = await db.select().from(cronState).where(eq(cronState.isActive, true));

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const queue = getSignalCollectorQueue();

  for (const row of active) {
    // Lookup tolerates non-signal-collector job_types (e.g. step_pause_cleanup) —
    // they resolve to `undefined` and are skipped via the next guard.
    const source = SIGNAL_COLLECTOR_JOB_TYPE_TO_SOURCE[row.jobType as SignalCollectorJobType];
    if (!source) continue;

    const [latest] = await db
      .select({ collectedAt: externalSignals.collectedAt })
      .from(externalSignals)
      .where(
        and(
          eq(externalSignals.projectId, row.projectId),
          eq(externalSignals.source, source),
        ),
      )
      .orderBy(desc(externalSignals.collectedAt))
      .limit(1);

    if (latest && latest.collectedAt >= cutoff) {
      log.debug(
        { jobType: row.jobType, projectId: row.projectId, lastCollectedAt: latest.collectedAt },
        "Signal collector catch-up: fresh collection, skipping",
      );
      continue;
    }

    const jobName = `${row.jobType}:${row.projectId}`;
    // BullMQ rejects ':' in custom IDs (`Custom Id cannot contain :`),
    // so the jobId uses '_' separators. The jobName above stays colon-form
    // because the signal-collector worker dispatches on `name.startsWith(...)`.
    const jobId = `${row.jobType}_${row.projectId}_catchup_${todayUtc}`;
    await queue.add(
      jobName,
      { projectId: row.projectId, type: "cron-triggered" },
      { jobId },
    );
    log.info(
      { jobName, jobId, lastCollectedAt: latest?.collectedAt ?? null },
      "Signal collector catch-up enqueued",
    );
  }
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

  // Fire-and-forget: signal-collector catch-up for missed daily fires.
  catchUpStaleSignalCollectors().catch((err) => {
    log.warn({ err }, "Signal collector catch-up failed");
  });
}
