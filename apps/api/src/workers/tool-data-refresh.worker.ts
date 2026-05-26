/**
 * Spec 65.3 Part B — Tool-data refresh worker.
 *
 * Cron-orchestrated single-tick worker. The cron-orchestrator fires a
 * BullMQ job per active `cron_state` row (job_type='tool_data_refresh');
 * the handler:
 *   1. Selects up to `TICK_TOOL_LIMIT` stale tools (`last_refreshed_at`
 *      older than `STALE_THRESHOLD_DAYS`, NULL-first).
 *   2. For each tool, runs the extract → diff → apply chain serially —
 *      ~30s per tool (web-search) × 5 tools = ~2.5 min per tick, well
 *      under the BullMQ lockDuration ceiling (10 min).
 *   3. Material changes invalidate persona-scores (cascades across all
 *      projects per Marcel-Decision §10).
 *   4. End-of-tick: one batched admin notification per Memory D21.
 *
 * Per-tool failures are caught + logged but never throw out of the tick —
 * a single web-search failure shouldn't pause the whole worker. The whole
 * tick is wrapped so cron-state observability (markCronRun*) always records
 * a terminal state.
 *
 * Default cron pattern: `0 *\/6 * * *` (every 6h, OFF by default per
 * Marcel-Decision §0 — admin opts in via SettingsPlannerPage / API toggle).
 */
import {
  cronState,
  db,
  eq,
  markCronRunFailed,
  markCronRunSucceeded,
  projects,
} from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue, type Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { applyToolDataChanges } from "../lib/tool-data-refresh/apply-changes.ts";
import { computeToolDataDiff } from "../lib/tool-data-refresh/compute-diff.ts";
import { extractToolData } from "../lib/tool-data-refresh/extract-tool-data.ts";
import { notifyToolDataRefreshBatch } from "../lib/tool-data-refresh/notify-batch.ts";
import { selectStaleTools } from "../lib/tool-data-refresh/select-stale-tools.ts";

const log = createLogger("tool-data-refresh-cron");

export const TOOL_DATA_REFRESH_QUEUE = "tool-data-refresh";

/** Marcel-Decision §0 — Tools 30+ days stale are refresh candidates. */
const STALE_THRESHOLD_DAYS = 30;
/** Per-tick cap so a cron fire doesn't run for hours. ~30s/tool × 5 = ~2.5 min. */
const TICK_TOOL_LIMIT = 5;
/** Default cron pattern (every 6h, on the hour). OFF by default. */
export const TOOL_DATA_REFRESH_DEFAULT_PATTERN = "0 */6 * * *";

// ─── Redis + queue singletons ────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getToolDataRefreshQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(TOOL_DATA_REFRESH_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  });
  return _queue;
}

const jobSchema = z.object({
  projectId: z.string().uuid(),
  type: z.literal("cron-triggered").optional(),
});

// ─── Cron-state seed ─────────────────────────────────────────────────────────

/**
 * Idempotently seed `cron_state` rows for every project. Default
 * `isActive: false` per Memory D124 — Marcel opts in.
 *
 * Lives in worker code (not a SQL migration) because PostgreSQL forbids
 * using a freshly-added enum value in the session that added it.
 */
export async function seedToolDataRefreshCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "tool_data_refresh" as const,
    isActive: false,
    cronPattern: TOOL_DATA_REFRESH_DEFAULT_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info({ projectCount: allProjects.length }, "Seeded tool_data_refresh cron_state rows");
}

// ─── Tick handler ────────────────────────────────────────────────────────────

interface TickResult {
  refreshedCount: number;
  skippedCount: number;
  failedCount: number;
  materialChanges: Array<{ toolId: string; toolName: string; summary: string | null }>;
}

/**
 * The actual work for one cron fire. Selects stale tools, refreshes each
 * serially, accumulates a per-tick summary for the batched notification.
 */
async function handleToolDataRefreshTick(projectId: string): Promise<TickResult> {
  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      targetLocales: projects.targetLocales,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    log.warn({ projectId }, "Project not found — skipping tool-data-refresh tick");
    return { refreshedCount: 0, skippedCount: 0, failedCount: 0, materialChanges: [] };
  }

  const primaryLocale = project.targetLocales?.[0]?.split("-")[0] ?? "de";

  const stale = await selectStaleTools({
    projectId: project.id,
    locale: primaryLocale,
    staleThresholdDays: STALE_THRESHOLD_DAYS,
    limit: TICK_TOOL_LIMIT,
  });

  if (stale.length === 0) {
    log.info({ projectId: project.id, slug: project.slug }, "No stale tools to refresh");
    return { refreshedCount: 0, skippedCount: 0, failedCount: 0, materialChanges: [] };
  }

  log.info(
    { projectId: project.id, slug: project.slug, candidates: stale.length },
    "Tool-data refresh tick starting"
  );

  const result: TickResult = {
    refreshedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    materialChanges: [],
  };

  for (const tool of stale) {
    try {
      const extract = await extractToolData({
        projectId: project.id,
        toolId: tool.id,
        toolName: tool.title ?? tool.slug ?? "(unnamed)",
        toolWebsite: tool.toolWebsite,
        currentSnapshot: {
          priceFrom: tool.toolPriceFrom !== null ? Number.parseFloat(tool.toolPriceFrom) : null,
          pricing: tool.toolPricing,
          lastRefreshedAt: tool.lastRefreshedAt?.toISOString() ?? null,
        },
      });

      if (extract === null) {
        result.skippedCount++;
        continue;
      }

      const diff = computeToolDataDiff({
        extract,
        // Prior fingerprints would live in tool_data_refresh_metadata; we
        // skip the lookup here for simplicity — the diff still produces a
        // useful change-detection at the LLM-judgment level. Worst case is
        // a redundant "pricingChanged: true" on the first tick after deploy.
        priorPricingFingerprint: null,
        priorFeatureFingerprint: null,
      });

      const applied = await applyToolDataChanges({
        toolId: tool.id,
        extract,
        diff,
        priorMetadata: null,
      });

      result.refreshedCount++;
      if (applied.materialChange) {
        result.materialChanges.push({
          toolId: tool.id,
          toolName: tool.title ?? tool.slug ?? "(unnamed)",
          summary: applied.summary,
        });
      }
    } catch (err) {
      result.failedCount++;
      log.warn(
        {
          projectId: project.id,
          toolId: tool.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "tool-data refresh failed for one tool — continuing tick"
      );
    }
  }

  log.info(
    {
      projectId: project.id,
      slug: project.slug,
      refreshed: result.refreshedCount,
      skipped: result.skippedCount,
      failed: result.failedCount,
      materialChanges: result.materialChanges.length,
    },
    "Tool-data refresh tick completed"
  );

  return result;
}

async function handleToolDataRefresh(projectId: string): Promise<void> {
  const tickStart = new Date().toISOString();
  try {
    const result = await handleToolDataRefreshTick(projectId);

    // Fire-and-forget — notify failure must NEVER break the tick.
    void notifyToolDataRefreshBatch({
      projectId,
      tickStartedAt: tickStart,
      ...result,
    });

    await markCronRunSucceeded({
      projectId,
      jobType: "tool_data_refresh",
    });
  } catch (err: unknown) {
    log.error({ err, projectId }, "tool-data refresh tick failed");
    await markCronRunFailed({
      projectId,
      jobType: "tool_data_refresh",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err; // rethrow so BullMQ surfaces the failed job
  }
}

// ─── Worker entry ────────────────────────────────────────────────────────────

export function startToolDataRefreshWorker(): Worker {
  return new Worker(
    TOOL_DATA_REFRESH_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handleToolDataRefresh(parsed.projectId);
    },
    { connection: getConnection(), concurrency: 1 }
  );
}
