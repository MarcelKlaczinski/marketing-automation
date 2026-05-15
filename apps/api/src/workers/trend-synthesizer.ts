import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  db,
  externalSignals,
  topicBriefs,
  projects,
  and,
  eq,
  inArray,
  isNull,
  lt,
} from "@marketing-auto/db";
import { loadActiveConfig, TrendDiscoveryTopicSource } from "@marketing-auto/pipelines";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("trend-synthesizer");

export const TREND_SYNTHESIZER_QUEUE = "trend-synthesizer";

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getTrendSynthesizerQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(TREND_SYNTHESIZER_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail:    { count: 100 },
    },
  });
  return _queue;
}

// ─── Job schemas ──────────────────────────────────────────────────────────────

const scheduleDailyJobSchema = z.object({
  type: z.literal("schedule-daily"),
});

const synthesizeAllJobSchema = z.object({
  type: z.literal("synthesize-all"),
});

const synthesizeProjectJobSchema = z.object({
  type: z.literal("synthesize-project"),
  projectId: z.string().uuid(),
});

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startTrendSynthesizerWorker() {
  return new Worker(
    TREND_SYNTHESIZER_QUEUE,
    async (job: Job) => {
      const name = job.name;

      if (name === "schedule-daily") {
        scheduleDailyJobSchema.parse(job.data);
        await handleScheduleDaily();
        return;
      }

      if (name === "synthesize-all") {
        synthesizeAllJobSchema.parse(job.data);
        await handleSynthesizeAll();
        return;
      }

      if (name === "synthesize-project") {
        const data = synthesizeProjectJobSchema.parse(job.data);
        await handleSynthesizeProject(data.projectId);
        return;
      }

      throw new Error(`Unknown trend-synthesizer job name: ${name}`);
    },
    {
      connection: getConnection(),
      concurrency: 2,
    },
  );
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleScheduleDaily(): Promise<void> {
  const queue = getTrendSynthesizerQueue();
  await queue.add("synthesize-all", { type: "synthesize-all" });
  log.info("schedule-daily: enqueued synthesize-all");
}

async function handleSynthesizeAll(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  log.info({ count: allProjects.length }, "synthesize-all: fanning out synthesize-project jobs");

  const queue = getTrendSynthesizerQueue();
  for (const { id } of allProjects) {
    await queue.add(
      "synthesize-project",
      { type: "synthesize-project", projectId: id },
      { jobId: `synthesize-project-${id}-${new Date().toISOString().slice(0, 10)}` },
    );
  }
}

async function handleSynthesizeProject(projectId: string): Promise<void> {
  // Janitor: stamp signals older than 14 days that were never processed
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const expired = await db
    .update(externalSignals)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(externalSignals.projectId, projectId),
        isNull(externalSignals.processedAt),
        lt(externalSignals.collectedAt, cutoff),
      ),
    )
    .returning({ id: externalSignals.id });

  if (expired.length > 0) {
    log.info({ projectId, expiredCount: expired.length }, "janitor: stamped expired signals");
  }

  // Check project has an active config with at least one signal source enabled
  let config;
  try {
    config = await loadActiveConfig(projectId);
  } catch {
    log.info({ projectId }, "synthesize-project: no active config, skipping");
    return;
  }

  const sources = config.signalSources;
  const hasAnySources =
    sources.producthunt ||
    sources.hackernews.enabled ||
    sources.vendor_rss.enabled;

  if (!hasAnySources) {
    log.info({ projectId }, "synthesize-project: no signal sources enabled, skipping");
    return;
  }

  // Run synthesis — source owns signal stamping; caller owns brief persistence
  const source = new TrendDiscoveryTopicSource();
  const briefs = await source.emit({ projectId }, { projectId });

  if (briefs.length > 0) {
    // Strip undefined fields: TopicBriefInsert has T | undefined but Drizzle insert needs T | null
    type DrizzleInsert = typeof topicBriefs.$inferInsert;
    const rows = briefs.map(
      (b) =>
        Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as DrizzleInsert,
    );

    const inserted = await db.transaction(async (tx) => {
      return tx.insert(topicBriefs).values(rows).returning({ id: topicBriefs.id, trendMetadata: topicBriefs.trendMetadata });
    });

    // Stamp contributing signals with processed_into = brief.id now that we have the real IDs
    for (const row of inserted) {
      const meta = row.trendMetadata as { signals?: Array<{ id?: string }> } | null;
      const signalIds = (meta?.signals ?? []).map((s) => s.id).filter((id): id is string => typeof id === "string");
      if (signalIds.length > 0) {
        await db
          .update(externalSignals)
          .set({ processedAt: new Date(), processedInto: row.id })
          .where(and(inArray(externalSignals.id, signalIds), isNull(externalSignals.processedAt)));
      }
    }

    log.info({ projectId, briefsInserted: briefs.length }, "trend synthesis: briefs persisted");
  } else {
    log.info({ projectId }, "trend synthesis: no briefs emitted");
  }
}

// ─── Daily cron registration ──────────────────────────────────────────────────

export async function registerTrendSynthesizerCron(): Promise<void> {
  const cron = getEnv().TREND_SYNTHESIZER_CRON ?? "30 1 * * *";

  const queue = getTrendSynthesizerQueue();
  await queue.add(
    "schedule-daily",
    { type: "schedule-daily" },
    {
      repeat: { pattern: cron },
      jobId:  "trend-synthesizer-daily",
    },
  );

  log.info({ cron }, "trend-synthesizer daily cron registered");
}
