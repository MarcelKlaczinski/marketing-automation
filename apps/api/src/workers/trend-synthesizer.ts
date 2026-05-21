// Spec 54.5 (initial) + Spec 63.4 (per-project cron refactor):
// trend-synthesizer worker.
//
// Job shapes accepted:
//   1. Per-project cron tick from cron-orchestrator (Spec 63.4)
//        name: `trends_synthesizer:<projectId>`
//        data: { projectId, type: "cron-triggered" }
//   2. Legacy manual `synthesize-project` (CLI + 2 manual-trigger routes)
//        name: "synthesize-project"
//        data: { type: "synthesize-project", projectId }
//
// Both call the same `handleSynthesizeProject(projectId)`. The Spec 54.5
// global-fan-out (`schedule-daily` → `synthesize-all` → per-project) was
// removed in Spec 63.4 in favour of the per-project cron_state pattern shared
// with planner_weekly_generation (62.7) and comparison_discovery (63.3b).

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  buildTrendSynthCronPattern,
  cronState,
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

/**
 * Spec 63.4: default cron pattern for newly-seeded `cron_state` rows. Daily
 * 01:00 UTC (~30 min after the signal-collectors run at 00:30 UTC) so fresh
 * signals get synthesized into briefs the same day. Default `isActive: false`
 * — Marcel toggles per-project in SettingsPlannerPage.
 */
export const TREND_SYNTHESIZER_DEFAULT_PATTERN = buildTrendSynthCronPattern(null, 1);

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

// Cron-orchestrator and legacy "synthesize-project" callers both reduce to a
// single { projectId } shape — the worker doesn't care about the discriminator
// once we have the projectId.
const jobSchema = z
  .object({
    projectId: z.string().uuid(),
    type: z.enum(["cron-triggered", "synthesize-project"]).optional(),
  })
  // Tolerate legacy callers that send extra fields — only `projectId` matters.
  .passthrough();

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startTrendSynthesizerWorker() {
  return new Worker(
    TREND_SYNTHESIZER_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handleSynthesizeProject(parsed.projectId);
    },
    {
      connection: getConnection(),
      concurrency: 2,
    },
  );
}

// ─── Per-project seed (Spec 63.4) ─────────────────────────────────────────────

/**
 * Idempotently seed `cron_state` rows for every project so the orchestrator
 * picks them up on its next tick. Default `isActive: false` — Marcel toggles
 * per-project in SettingsPlannerPage.
 *
 * Lives in worker code (not a SQL migration) for symmetry with
 * seedPlannerWeeklyGenerationCron (Spec 62.7) and seedComparisonDiscoveryCron
 * (Spec 63.3b), even though the `trends_synthesizer` enum value pre-exists
 * since Spec 56.6 (no Memory D124 ordering constraint here).
 */
export async function seedTrendSynthesizerCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "trends_synthesizer" as const,
    isActive: false,
    cronPattern: TREND_SYNTHESIZER_DEFAULT_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info({ projectCount: allProjects.length }, "Seeded trends_synthesizer cron_state rows");
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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
      const signalIds = (row.trendMetadata?.signals ?? []).map((s) => s.id);
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
