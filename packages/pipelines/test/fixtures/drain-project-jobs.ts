// Test-cleanup helper for the project-delete vs BullMQ-job race (Phase-E
// diagnose 2026-05-22).
//
// Background: when a test creates a project, triggers a real BullMQ enqueue
// (e.g. by calling `ArticleSyncPipeline.afterComplete()` end-to-end), and then
// deletes the project in afterAll, the PG row goes away via ON DELETE CASCADE
// but the BullMQ job survives in Redis. The worker picks it up later, tries to
// INSERT pipeline_runs with the now-orphan projectId, and FK-fails — surfacing
// a "Pipeline failed - localhost" notification to Marcel.
//
// The runner guard in `runPipeline()` makes this safe at the worker level (the
// job completes as a no-op), but draining at test teardown is still the right
// hygiene: it keeps the queue clean and prevents the worker from doing pointless
// pickups for projects that no longer exist.
//
// USE THIS HELPER in `afterAll`:
//   import { drainProjectJobs } from "../fixtures/drain-project-jobs.ts";
//   afterAll(async () => {
//     await drainProjectJobs(projectId);
//     await db.delete(projects).where(eq(projects.id, projectId));
//   });
//
// Tests that mock `engine/queue.ts` don't need this — their jobs never reach
// Redis in the first place.

import { getPipelineQueue } from "../../src/engine/queue.ts";

type JobLike = {
  data?: { projectId?: unknown; input?: { projectId?: unknown } };
  remove(): Promise<void>;
};

/**
 * Remove every BullMQ job in the shared `pipelines` queue whose data.projectId
 * matches the given id. Covers waiting, delayed, active, failed, and completed
 * lifecycle slots so nothing lingers after the test process exits.
 *
 * Safe to call when Redis is unreachable — the underlying `getJobs` call throws
 * a connection error which we swallow (test env may be Redis-less).
 */
export async function drainProjectJobs(projectId: string): Promise<number> {
  let removed = 0;
  try {
    const queue = getPipelineQueue();
    const jobs = (await queue.getJobs([
      "waiting",
      "delayed",
      "active",
      "failed",
      "completed",
    ])) as unknown as JobLike[];

    for (const job of jobs) {
      const top = typeof job.data?.projectId === "string" ? job.data.projectId : undefined;
      const inner =
        typeof job.data?.input?.projectId === "string" ? job.data.input.projectId : undefined;
      if (top === projectId || inner === projectId) {
        await job.remove();
        removed += 1;
      }
    }
  } catch {
    // Redis unreachable in this test env — nothing to drain.
  }
  return removed;
}
