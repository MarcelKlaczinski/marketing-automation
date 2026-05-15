import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { db, externalSignals, projects, type NewExternalSignal } from "@marketing-auto/db";
import { loadActiveConfig } from "@marketing-auto/pipelines";
import { RawSignalSchema, type RawSignal } from "@marketing-auto/pipelines";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { readAdapterCreds } from "../lib/system-service.ts";
import { ProductHuntSignalSource } from "@marketing-auto/adapter-producthunt";
import { HackerNewsSignalSource } from "@marketing-auto/adapter-hackernews";
import { VendorRssSignalSource } from "@marketing-auto/adapter-vendor-rss";

const log = createLogger("signal-collector");

export const SIGNAL_COLLECTOR_QUEUE = "signal-collector";

// ─── Redis connection (module-level singleton) ────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getSignalCollectorQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(SIGNAL_COLLECTOR_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });
  return _queue;
}

// ─── Job schemas ──────────────────────────────────────────────────────────────

const scheduleDailyJobSchema = z.object({
  type: z.literal("schedule-daily"),
});

const collectProjectJobSchema = z.object({
  type: z.literal("collect-project"),
  projectId: z.string().uuid(),
});

const collectAdapterJobSchema = z.object({
  type: z.literal("collect-adapter"),
  projectId: z.string().uuid(),
  adapter: z.enum(["producthunt", "hackernews", "vendor_rss"]),
});

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startSignalCollectorWorker() {
  return new Worker(
    SIGNAL_COLLECTOR_QUEUE,
    async (job: Job) => {
      const name = job.name;

      if (name === "schedule-daily") {
        scheduleDailyJobSchema.parse(job.data);
        await handleScheduleDaily();
        return;
      }

      if (name === "collect-project") {
        const data = collectProjectJobSchema.parse(job.data);
        await handleCollectProject(data.projectId);
        return;
      }

      if (name === "collect-adapter") {
        const data = collectAdapterJobSchema.parse(job.data);
        await handleCollectAdapter(data.projectId, data.adapter);
        return;
      }

      throw new Error(`Unknown signal-collector job name: ${name}`);
    },
    {
      connection: getConnection(),
      concurrency: 4,
    },
  );
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleScheduleDaily(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  log.info({ count: allProjects.length }, "schedule-daily: fanning out collect-project jobs");

  const queue = getSignalCollectorQueue();
  for (const { id } of allProjects) {
    await queue.add("collect-project", { type: "collect-project", projectId: id });
  }
}

async function handleCollectProject(projectId: string): Promise<void> {
  let config;
  try {
    config = await loadActiveConfig(projectId);
  } catch (err) {
    log.warn({ projectId, err }, "collect-project: no active config, skipping");
    return;
  }

  const enabled: Array<"producthunt" | "hackernews" | "vendor_rss"> = [];
  if (config.signalSources.producthunt) enabled.push("producthunt");
  if (config.signalSources.hackernews)  enabled.push("hackernews");
  if (config.signalSources.vendor_rss.enabled) enabled.push("vendor_rss");

  if (enabled.length === 0) {
    log.info({ projectId }, "collect-project: no signal sources enabled, skipping");
    return;
  }

  log.info({ projectId, enabled }, "collect-project: fanning out collect-adapter jobs");

  const queue = getSignalCollectorQueue();
  for (const adapter of enabled) {
    await queue.add("collect-adapter", { type: "collect-adapter", projectId, adapter });
  }
}

async function handleCollectAdapter(
  projectId: string,
  adapter: "producthunt" | "hackernews" | "vendor_rss",
): Promise<void> {
  const ctx = { projectId };
  let signals: RawSignal[] = [];

  switch (adapter) {
    case "producthunt": {
      const creds = await readAdapterCreds("producthunt");
      if (!creds.api_key || !creds.api_secret) throw new Error("producthunt api_key and api_secret credentials not configured");
      // Empty object — inputSchema.parse() applies defaults (topic + first)
      signals = await new ProductHuntSignalSource(creds.api_key, creds.api_secret).fetch({} as never, ctx);
      break;
    }
    case "hackernews": {
      // Empty object — inputSchema.parse() applies defaults (query, hitsPerPage, minPoints)
      signals = await new HackerNewsSignalSource().fetch({} as never, ctx);
      break;
    }
    case "vendor_rss": {
      let config;
      try {
        config = await loadActiveConfig(projectId);
      } catch {
        log.warn({ projectId }, "vendor_rss: no active config, skipping");
        return;
      }
      const feeds = config.signalSources.vendor_rss.feeds;
      if (feeds.length === 0) {
        log.warn({ projectId }, "vendor_rss: enabled but no feeds configured");
        return;
      }
      signals = await new VendorRssSignalSource().fetch({ feeds }, ctx);
      break;
    }
  }

  // Validate each signal — drop malformed adapter output rather than crashing
  const validated = signals.flatMap((s) => {
    const result = RawSignalSchema.safeParse(s);
    if (!result.success) {
      log.warn({ adapter, errors: result.error.flatten() }, "invalid signal dropped");
      return [];
    }
    return [result.data];
  });

  if (validated.length === 0) {
    log.info({ projectId, adapter }, "no valid signals to persist");
    return;
  }

  const rows: NewExternalSignal[] = validated.map((s) => ({
    projectId,
    source:      s.source,
    externalId:  s.externalId,
    title:       s.title,
    url:         s.url         ?? null,
    summary:     s.summary     ?? null,
    author:      s.author      ?? null,
    publishedAt: s.publishedAt ?? null,
    rawPayload:  s.rawPayload,
    metrics:     s.metrics     ?? {},
  }));

  await db.transaction(async (tx) => {
    // conflict-do-nothing on (source, external_id) — full unique index, no targetWhere needed
    await tx
      .insert(externalSignals)
      .values(rows)
      .onConflictDoNothing({
        target: [externalSignals.source, externalSignals.externalId],
      });
  });

  log.info({ projectId, adapter, fetched: signals.length, persisted: validated.length }, "signals persisted");
}

// ─── Daily cron registration ──────────────────────────────────────────────────

export async function registerSignalCollectorCron(): Promise<void> {
  const cron = getEnv().SIGNAL_COLLECTOR_CRON ?? "30 0 * * *";

  const queue = getSignalCollectorQueue();
  await queue.add(
    "schedule-daily",
    { type: "schedule-daily" },
    {
      repeat:  { pattern: cron },
      jobId:   "signal-collector-daily",
    },
  );

  log.info({ cron }, "signal-collector daily cron registered");
}
