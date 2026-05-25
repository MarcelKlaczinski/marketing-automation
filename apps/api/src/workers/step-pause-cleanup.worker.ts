// Spec 62.0a Section 4.5.3: defense-in-depth cleanup worker.
//
// Finds substep rows stuck in status='running' for >24h (typically the result of a
// process-kill between supersedeOldSubstep at re-execute time and the runner's normal
// completion path) and marks them as 'superseded'.
//
// Scheduled by the cron-orchestrator from cron_state rows (one per project, defaulting
// to is_active=true and pattern '0 */6 * * *' per migration 0068). The reap query itself
// is global — running the worker per-project N times within each 6h window is acceptable
// because the UPDATE is idempotent (subsequent runs find zero matching rows).

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  cronState,
  db,
  markCronRunFailed,
  markCronRunSucceeded,
  projects,
  reapStuckSubsteps,
} from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("step-pause-cleanup");

export const STEP_PAUSE_CLEANUP_QUEUE = "step-pause-cleanup";

/** Default cron pattern for new project cron_state rows. Every 6 hours on the hour. */
export const STEP_PAUSE_CLEANUP_CRON_PATTERN = "0 */6 * * *";

const STUCK_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getStepPauseCleanupQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(STEP_PAUSE_CLEANUP_QUEUE, {
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
  projectId: z.string().uuid().optional(),
  type: z.literal("cron-triggered").optional(),
});

/**
 * Spec 62.0a Section 4.5.3: idempotently seed `cron_state` rows so every project gets
 * the step-pause-cleanup repeat job on the next cron-orchestrator tick.
 *
 * Lives in worker code (not a SQL migration) because PostgreSQL forbids using a new
 * enum value in the same session that added it. The seed runs once at worker startup
 * via `onConflictDoNothing` on the `(project_id, job_type)` unique constraint.
 *
 * Default: is_active=true (defense-in-depth — reaping stuck substeps is always safe).
 */
export async function seedStepPauseCleanupCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "step_pause_cleanup" as const,
    isActive: true,
    cronPattern: STEP_PAUSE_CLEANUP_CRON_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info({ projectCount: allProjects.length }, "Seeded step-pause-cleanup cron_state rows");
}

export function startStepPauseCleanupWorker() {
  return new Worker(
    STEP_PAUSE_CLEANUP_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      const cutoff = new Date(Date.now() - STUCK_CUTOFF_MS);
      try {
        const reaped = await reapStuckSubsteps(cutoff);
        log.info(
          {
            reaped,
            cutoff: cutoff.toISOString(),
            ...(parsed.projectId !== undefined ? { triggeredFor: parsed.projectId } : {}),
          },
          reaped > 0 ? "Reaped stuck substep rows" : "No stuck substeps to reap"
        );
        // Spec 62.7-followup — record cron_state.lastRun*. Reap is global (no
        // project filter), but cron_state is keyed by (project_id, jobType).
        // Record for the project that triggered this tick when known;
        // skip if the fire was unscoped (very rare — only happens for legacy
        // adhoc enqueues without projectId).
        if (parsed.projectId !== undefined) {
          await markCronRunSucceeded({
            projectId: parsed.projectId,
            jobType: "step_pause_cleanup",
          });
        }
      } catch (err) {
        if (parsed.projectId !== undefined) {
          await markCronRunFailed({
            projectId: parsed.projectId,
            jobType: "step_pause_cleanup",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    },
    { connection: getConnection(), concurrency: 1 }
  );
}
