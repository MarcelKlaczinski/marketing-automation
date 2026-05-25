/**
 * Spec 65.1 — Auto-prune cron for `template_usage_log`.
 *
 * Per Marcel-Decision Q3, each `recurring_content_definitions` row is capped
 * at `TEMPLATE_USAGE_LOG_CAP` (default 50) entries in `template_usage_log`.
 * The 65.6 LRU template-picker only reads the most-recent N rows, so anything
 * beyond the cap is dead weight in the table; this cron sweeps it daily.
 *
 * Lifecycle:
 *   - Started once in `server.ts` (API process) — single-instance per Memory
 *     D24 cron-based-coordinator pattern. Do NOT start in worker processes
 *     (would multi-run the prune).
 *   - `.unref()` on the interval handle so the process can exit cleanly in
 *     tests + graceful-shutdown paths.
 *   - Per-tick errors are caught + logged; a single tick failure never
 *     escalates into server-startup crash.
 *
 * Cadence: daily (24h). Cheaper alternative to BullMQ since the work is one
 * DELETE per definition and there's no fan-out — `setInterval` matches the
 * existing pattern for the 65.0 Day-6 periodic cache + preview sweep.
 */
import { pruneAllTemplateUsageLog } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("template-usage-log-prune-cron");

export const TEMPLATE_USAGE_LOG_CAP = 50;
const PRUNE_CADENCE_MS = 24 * 60 * 60 * 1000; // daily

let pruneInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Run one prune tick — exposed for tests so they can assert the side effect
 * without waiting 24h for the interval to fire.
 */
export async function runTemplateUsageLogPruneTick(): Promise<{
  definitionsPruned: number;
  rowsDeleted: number;
}> {
  const result = await pruneAllTemplateUsageLog({ keepLastN: TEMPLATE_USAGE_LOG_CAP });
  if (result.definitionsPruned > 0) {
    log.info(
      { definitionsPruned: result.definitionsPruned, rowsDeleted: result.rowsDeleted },
      "Template usage log prune complete"
    );
  }
  return result;
}

/**
 * Idempotent: safe to call multiple times. If a prior cron is still active,
 * this is a no-op so we don't accidentally double-schedule (Memory D24).
 */
export function startTemplateUsageLogPruneCron(): void {
  if (pruneInterval !== null) {
    log.debug("Template-usage-log prune cron already running — skipping start");
    return;
  }
  pruneInterval = setInterval(() => {
    void runTemplateUsageLogPruneTick().catch((err) => {
      log.error({ err }, "Template usage log prune tick failed");
    });
  }, PRUNE_CADENCE_MS);
  // `.unref()` so the Node/Bun event loop can exit naturally — otherwise the
  // process would stay alive for the timer even after server.close().
  pruneInterval.unref();
  log.info(
    { cadenceMs: PRUNE_CADENCE_MS, cap: TEMPLATE_USAGE_LOG_CAP },
    "Template usage log prune cron started"
  );
}

export function stopTemplateUsageLogPruneCron(): void {
  if (pruneInterval !== null) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}
