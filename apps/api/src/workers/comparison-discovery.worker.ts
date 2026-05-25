// Spec 63.3b: weekly cron trigger for comparison-pair discovery.
//
// Cron-orchestrator registers a BullMQ repeatable job per active `cron_state`
// row (job_type='comparison_discovery') with the pattern derived from
// project_planner_config.comparison_cron_day_of_week + comparison_cron_hour_utc.
// When the job fires this worker calls discoverComparisonPairs() directly
// (no HTTP roundtrip) for the project.
//
// Comparison-discovery is a *free function* (not a registered pipeline), so we
// don't wrap it with `triggerWithPreRunId` — there's no `pipeline_runs` row to
// pre-INSERT. Errors are logged but do not throw out of the worker handler so
// the BullMQ job (attempts=1) does not retry and re-spend on the DB scan.
//
// Default OFF — Marcel toggles per-project in SettingsPlannerPage.

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  buildPlannerCronPattern,
  cronState,
  db,
  eq,
  markCronRunFailed,
  markCronRunSucceeded,
  projects,
} from "@marketing-auto/db";
import { discoverComparisonPairs } from "@marketing-auto/planner";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("comparison-discovery-cron");

export const COMPARISON_DISCOVERY_QUEUE = "comparison-discovery";

/**
 * Default cron pattern for newly-seeded rows. Sunday 06:00 UTC = 12 hours
 * before the planner-weekly-generation default (Sunday 18:00 UTC), giving
 * Marcel a half-day window to review the freshly-discovered pending pairs
 * before the plan-generation cron picks them up. Default `isActive: false`
 * keeps cron OFF until Marcel toggles it in SettingsPlannerPage.
 */
export const COMPARISON_DISCOVERY_DEFAULT_PATTERN = buildPlannerCronPattern(0, 6);

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getComparisonDiscoveryQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(COMPARISON_DISCOVERY_QUEUE, {
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

/**
 * Idempotently seed `cron_state` rows for every project so the orchestrator
 * picks them up on its next tick. Default `isActive: false` — Marcel toggles
 * the cron on per-project in SettingsPlannerPage.
 *
 * Lives in worker code (not a SQL migration) because PostgreSQL forbids using
 * a freshly-added enum value in the same session it was added (Memory D124 —
 * canonical pattern from seedPlannerWeeklyGenerationCron, Spec 62.7).
 */
export async function seedComparisonDiscoveryCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "comparison_discovery" as const,
    isActive: false,
    cronPattern: COMPARISON_DISCOVERY_DEFAULT_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info({ projectCount: allProjects.length }, "Seeded comparison_discovery cron_state rows");
}

/**
 * The work performed when the cron fires. Resolves the project's slug for
 * logging and runs `discoverComparisonPairs()` against the project. The free
 * function persists pending TopicBrief rows via its own transaction; no pre-
 * run row is needed.
 */
async function handleComparisonDiscovery(projectId: string): Promise<void> {
  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!proj) {
    log.warn({ projectId }, "Project not found — skipping comparison-discovery cron tick");
    return;
  }

  try {
    const result = await discoverComparisonPairs({ projectId: proj.id });
    log.info(
      {
        projectId: proj.id,
        slug: proj.slug,
        pairsFound: result.pairsFound,
        pairsScored: result.pairsScored,
        pairsAboveThreshold: result.pairsAboveThreshold,
        pairsPersisted: result.pairsPersisted,
        durationMs: result.durationMs,
      },
      "Comparison-discovery cron tick completed",
    );
    // Spec 62.7-followup — record success for the Settings UI.
    await markCronRunSucceeded({
      projectId: proj.id,
      jobType: "comparison_discovery",
    });
  } catch (err: unknown) {
    // Don't rethrow — the BullMQ job is `attempts: 1`, so re-throwing would
    // mark the fire as failed (with no retry) and add nothing actionable.
    // Note: this diverges from the other cron-orchestrated workers (trend-
    // synthesizer, signal-collector, quality-analysis, refresh-detector,
    // github-inventory-*) which DO rethrow after `markCronRunFailed` so
    // BullMQ surfaces a failed job in the dashboard. comparison-discovery
    // is intentionally quieter because (a) discovery only writes pending
    // briefs that Marcel reviews, so a missed tick is harmless, and (b)
    // the cron_state.lastRunStatus='failed' + the warning log already give
    // Marcel-side observability.
    log.error({ err, projectId: proj.id, slug: proj.slug }, "Comparison-discovery cron tick failed");
    await markCronRunFailed({
      projectId: proj.id,
      jobType: "comparison_discovery",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startComparisonDiscoveryWorker() {
  return new Worker(
    COMPARISON_DISCOVERY_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handleComparisonDiscovery(parsed.projectId);
    },
    { connection: getConnection(), concurrency: 1 },
  );
}
