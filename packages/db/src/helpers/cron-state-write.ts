/**
 * Spec 62.7 follow-up — observability writes for `cron_state.lastRun*`.
 *
 * The columns `last_run_at`, `last_run_status`, `last_run_error` were declared
 * in migration 0076 (Spec 62.7) but never written by any code path — meaning
 * the Settings UI's "Letzter Lauf" indicator stayed at "—" forever. This
 * helper fills the gap: workers call `markCronRunSucceeded()` at end-of-tick
 * (success) or `markCronRunFailed()` in their catch branch.
 *
 * The (`projectId`, `jobType`) tuple uniquely identifies a cron_state row via
 * the unique constraint declared in `packages/db/src/schema/cron.ts`. If no
 * matching row exists (e.g. cron not yet seeded for a new project, or the
 * worker fires for an unscoped manual trigger), the UPDATE is a no-op — same
 * posture as the existing seed helpers.
 *
 * **Worker contract:**
 *
 * - Call ONE of `markCronRunSucceeded` / `markCronRunFailed` exactly once per
 *   tick, regardless of how the tick was triggered (cron or manual "Run Now"
 *   button). Idempotent — re-calling within the same tick overwrites the
 *   timestamp, which is fine.
 *
 * - "Success" semantically means "the cron tick reached its terminal state
 *   without throwing", NOT "the cron did productive work". This deliberately
 *   includes:
 *     • no-op ticks (e.g. inventory-refresh found no due rows)
 *     • guard-blocked ticks (e.g. planner-weekly-generation hit a cost-limit
 *       or pause guard — the cron did its job, the gate is intentional)
 *     • dedup paths (e.g. PlanAlreadyExistsError — the cron correctly
 *       recognised the work was already done)
 *     • partial-fetcher failures inside a tick (e.g. one of several signal
 *       sources threw but the tick continued and persisted what it could)
 *   This matches Marcel's UX intent: "Letzter Lauf" should show the latest
 *   timestamp the cron actually fired, not just the latest one where new
 *   data was produced.
 *
 * - "Failed" is reserved for catastrophic exceptions that abort the tick.
 *   Most workers re-throw after `markCronRunFailed` so BullMQ also marks the
 *   job as failed in its dashboard. `comparison-discovery` is the one
 *   intentional exception (see its inline comment for the rationale).
 *
 * - Manual one-off enqueues that aren't cron ticks (e.g. signal-collector's
 *   `collect-adapter` job name) MUST NOT call these helpers — they'd
 *   overwrite the legitimate cron timestamp with a manual fire that wasn't
 *   visible in the Settings UI.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { cronJobTypeEnum, cronState } from "../schema/cron.ts";

/** Re-derived from the pgEnum so callers don't need to import the enum array. */
export type CronJobType = (typeof cronJobTypeEnum.enumValues)[number];

export interface MarkCronRunInput {
  projectId: string;
  jobType: CronJobType;
  /** When omitted, defaults to NOW(). */
  ranAt?: Date;
}

export async function markCronRunSucceeded(input: MarkCronRunInput): Promise<void> {
  const ts = input.ranAt ?? new Date();
  await db
    .update(cronState)
    .set({
      lastRunAt:     ts,
      lastRunStatus: "success",
      lastRunError:  null,
      updatedAt:     ts,
    })
    .where(
      and(
        eq(cronState.projectId, input.projectId),
        eq(cronState.jobType, input.jobType),
      ),
    );
}

export interface MarkCronRunFailedInput extends MarkCronRunInput {
  errorMessage: string;
}

export async function markCronRunFailed(input: MarkCronRunFailedInput): Promise<void> {
  const ts = input.ranAt ?? new Date();
  // Truncate to keep the column readable; full stack trace lives in worker logs.
  const trimmed = input.errorMessage.length > 500
    ? `${input.errorMessage.slice(0, 497)}...`
    : input.errorMessage;
  await db
    .update(cronState)
    .set({
      lastRunAt:     ts,
      lastRunStatus: "failed",
      lastRunError:  trimmed,
      updatedAt:     ts,
    })
    .where(
      and(
        eq(cronState.projectId, input.projectId),
        eq(cronState.jobType, input.jobType),
      ),
    );
}
