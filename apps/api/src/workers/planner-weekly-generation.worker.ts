// Spec 62.7: weekly cron trigger for PlanWeekPipeline.
//
// Cron-orchestrator (cron-orchestrator.ts) registers a BullMQ repeatable job
// per active `cron_state` row (job_type='planner_weekly_generation') with the
// pattern derived from project_planner_config.cron_day_of_week + cron_hour_utc.
// When the job fires this worker:
//   1. Resolves the slug (for triggerWithPreRunId guard contracts)
//   2. Computes the next ISO week (computeNextIsoWeek from @marketing-auto/planner)
//   3. Triggers PlanWeekPipeline via the SAME helper the HTTP route uses, so
//      project-pause / cost / idempotency guards apply identically
//
// `force: false` — when a draft/approved plan already exists for next week, the
// trigger short-circuits via the partial unique index in weekly_plans and the
// run is deduped (200, no new run). The cron job is idempotent: multiple fires
// in the same week do not produce duplicate plans.
//
// triggeredBy: 'cron' — distinguishes from manual UI triggers in audit + ui-
// metadata (already a recognised field per Spec 62.4).

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  buildPlannerCronPattern,
  cronState,
  db,
  eq,
  PlanAlreadyExistsError,
  projects,
} from "@marketing-auto/db";
import { computeNextIsoWeek } from "@marketing-auto/planner";
import { enqueuePlanWeekPipeline } from "@marketing-auto/pipelines";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { triggerWithPreRunId } from "../routes/_lib/trigger-helpers.ts";

const log = createLogger("planner-weekly-generation");

export const PLANNER_WEEKLY_GENERATION_QUEUE = "planner-weekly-generation";

/**
 * Default cron pattern for newly-seeded rows. Sunday 18:00 UTC = Monday 19:00
 * CET / 20:00 CEST — clear of the daily signal-collectors at 02-03 UTC and the
 * trend-synthesiser at 01:30 UTC. Default `isActive: false` keeps cron OFF
 * until Marcel toggles it in SettingsPlannerPage.
 */
export const PLANNER_WEEKLY_GENERATION_DEFAULT_PATTERN = buildPlannerCronPattern(0, 18);

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getPlannerWeeklyGenerationQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(PLANNER_WEEKLY_GENERATION_QUEUE, {
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
 * Spec 62.7: idempotently seed `cron_state` rows for every project so the
 * orchestrator picks them up on its next tick. Default `isActive: false` —
 * Marcel toggles the cron on per-project in SettingsPlannerPage.
 *
 * Lives in worker code (not a SQL migration) because PostgreSQL forbids using
 * a freshly-added enum value in the same session it was added (canonical
 * pattern from `seedStepPauseCleanupCron`, Spec 62.0a Section 4.5.3).
 */
export async function seedPlannerWeeklyGenerationCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "planner_weekly_generation" as const,
    isActive: false,
    cronPattern: PLANNER_WEEKLY_GENERATION_DEFAULT_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info({ projectCount: allProjects.length }, "Seeded planner_weekly_generation cron_state rows");
}

/**
 * The actual work performed when the cron fires (or a one-off catch-up enqueues
 * a job). Resolves slug, computes next ISO week, calls triggerWithPreRunId so
 * the standard project-pause / cost / idempotency guards apply.
 */
async function handlePlannerWeeklyGeneration(projectId: string): Promise<void> {
  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!proj) {
    log.warn({ projectId }, "Project not found — skipping planner cron tick");
    return;
  }

  const { year, isoWeek } = computeNextIsoWeek();
  const planKey = `${year}-${isoWeek}`;
  const triggeredBy = "cron";

  try {
    const result = await triggerWithPreRunId({
      pipelineName: "planning:weekly",
      projectId: proj.id,
      uniqueKey: { field: "planKey", value: planKey },
      enqueue: (input) =>
        enqueuePlanWeekPipeline({
          ...input,
          triggeredBy,
          targetYear: year,
          targetIsoWeek: isoWeek,
          force: false,
        }),
      extraInput: {
        planKey,
        targetYear: year,
        targetIsoWeek: isoWeek,
        force: false,
        triggeredBy,
      },
    });
    // TriggerResult union: error variants have an `error` field; success variants
    // carry deduped:true|false. The narrowing here mirrors triggerResultToResponse.
    if ("error" in result) {
      log.warn(
        { projectId: proj.id, slug: proj.slug, planKey, blocked: result.error },
        "Planner cron tick blocked by guard",
      );
      return;
    }
    log.info(
      {
        projectId: proj.id,
        slug: proj.slug,
        planKey,
        deduped: result.deduped,
        runId: result.runId,
      },
      result.deduped
        ? "Planner cron tick deduped — plan already in flight for next week"
        : "Planner cron tick triggered PlanWeekPipeline",
    );
  } catch (err: unknown) {
    if (err instanceof PlanAlreadyExistsError) {
      log.info(
        { projectId: proj.id, slug: proj.slug, planKey, existingPlanId: err.existingPlanId },
        "Planner cron tick — plan already exists for next week, skipping",
      );
      return;
    }
    // Don't rethrow — the BullMQ job is `attempts: 1`, so re-throwing would
    // mark this fire as failed (with no retry). Logging here is enough; the
    // user-facing Quarantine view picks up failed pipeline_runs separately.
    log.error({ err, projectId: proj.id, slug: proj.slug, planKey }, "Planner cron tick failed");
  }
}

export function startPlannerWeeklyGenerationWorker() {
  return new Worker(
    PLANNER_WEEKLY_GENERATION_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handlePlannerWeeklyGeneration(parsed.projectId);
    },
    { connection: getConnection(), concurrency: 1 },
  );
}
