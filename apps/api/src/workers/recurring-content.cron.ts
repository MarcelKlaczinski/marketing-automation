/**
 * Spec 65.5 — Recurring-content cron coordinator.
 *
 * Per Marcel-Decision Cron Cadence: `*\/15 * * * *` (every 15 min). The
 * coordinator polls `listDueRecurringDefinitions()` and enqueues one BullMQ
 * job per due definition into the `recurring-brief-generator` queue.
 *
 * Single-instance enforcement: lives ONLY in the API process (started by
 * `server.ts`). NOT started by `workers/index.ts` — Memory D17 + D24.
 *
 * Per-tick batch size cap (`BATCH_SIZE = 10`) prevents stampede when a fresh
 * project seeds 50+ definitions at once. The cron-side `listDueRecurringDefinitions`
 * already applies a 30-second race buffer + secondary `id` sort, so missed
 * rows in one tick are picked up in the next.
 */
import { listDueRecurringDefinitions } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { enqueueRecurringBriefGenerator } from "./recurring-brief-generator.worker.ts";

const log = createLogger("recurring-content-cron");

/** 15 min — matches Marcel-Decision §0. */
const CRON_INTERVAL_MS = 15 * 60 * 1000;
/** Per-tick fan-out cap. */
const BATCH_SIZE = 10;

let cronInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Run one cron tick — exposed for tests so they can fan out without
 * waiting 15 min. Errors are caught + logged here; a failed tick doesn't
 * crash the API.
 */
export async function runRecurringContentCronTick(): Promise<{ enqueued: number }> {
  try {
    const due = await listDueRecurringDefinitions({ limit: BATCH_SIZE });
    if (due.length === 0) return { enqueued: 0 };

    log.info({ dueCount: due.length }, "recurring-content cron triggered");

    let enqueued = 0;
    for (const def of due) {
      try {
        await enqueueRecurringBriefGenerator({
          definitionId: def.id,
          projectId: def.projectId,
        });
        enqueued += 1;
      } catch (err) {
        log.warn(
          {
            definitionId: def.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "recurring-content cron: enqueue failed for definition (continuing)",
        );
      }
    }
    return { enqueued };
  } catch (err) {
    log.error({ err }, "recurring-content cron: listDueRecurringDefinitions failed");
    return { enqueued: 0 };
  }
}

/**
 * Idempotent: safe to call multiple times. Memory D24 — never double-schedule.
 */
export function startRecurringContentCron(): void {
  if (cronInterval !== null) {
    log.debug("recurring-content cron already running — skipping start");
    return;
  }
  cronInterval = setInterval(() => {
    void runRecurringContentCronTick().catch((err) => {
      log.error({ err }, "recurring-content cron tick failed");
    });
  }, CRON_INTERVAL_MS);
  cronInterval.unref();
  log.info({ cadenceMs: CRON_INTERVAL_MS, batchSize: BATCH_SIZE }, "recurring-content cron started");
}

export function stopRecurringContentCron(): void {
  if (cronInterval !== null) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}
