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
 * matching row exists (e.g. cron not yet seeded for a new project), the
 * UPDATE is a no-op — same posture as the existing seed helpers.
 *
 * Worker contract: call ONE of `markCronRunSucceeded` / `markCronRunFailed`
 * exactly once per tick, regardless of how the tick was triggered (cron or
 * manual "Run Now" button). Idempotent — re-calling within the same tick
 * overwrites the timestamp, which is fine.
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
