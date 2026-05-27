/**
 * Spec 65.V1.5b — Brief-skip notification cooldown.
 *
 * Wraps `notifyRecurringBriefSkipped` (Spec 65.5) with a 24h cooldown:
 * if `definition.lastSkipNotifiedAt < NOW() - 24h` (or NULL), the
 * notification fires and the timestamp is updated; otherwise the
 * notification is suppressed silently (per spec Q12: log silently,
 * NOT queue + send-once-at-cooldown-end).
 *
 * Idempotency: the timestamp update + notification dispatch happen in
 * the same call. A concurrent fire within the cooldown window won't
 * race because the cooldown check reads + writes against a definition
 * row that's already locked by the worker's Redis-lock (Spec 65.5).
 */

import { db, eq, recurringContentDefinitions } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import {
  notifyRecurringBriefSkipped,
  type NotifyRecurringBriefSkippedInput,
} from "./notify-skipped.ts";

const log = createLogger("recurring-content:skip-cooldown");

export const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface NotifyWithCooldownInput extends NotifyRecurringBriefSkippedInput {
  /** Last-notified timestamp from the definition row. NULL = never fired. */
  lastSkipNotifiedAt: Date | null;
}

/**
 * Returns `true` if the notification fired, `false` if it was suppressed
 * by the cooldown gate. Errors are swallowed inside
 * `notifyRecurringBriefSkipped` itself.
 */
export async function notifyBriefSkippedWithCooldown(
  input: NotifyWithCooldownInput,
): Promise<boolean> {
  const now = new Date();

  if (input.lastSkipNotifiedAt) {
    const elapsedMs = now.getTime() - input.lastSkipNotifiedAt.getTime();
    if (elapsedMs < SKIP_COOLDOWN_MS) {
      log.debug(
        {
          definitionId: input.definitionId,
          elapsedMs,
          cooldownMs: SKIP_COOLDOWN_MS,
        },
        "skip notification suppressed (cooldown active)",
      );
      return false;
    }
  }

  // Fire notification + stamp timestamp atomically — order matters: if the
  // notification fails (try/catch swallows it inside notify-skipped.ts), we
  // still want to advance the cooldown to avoid spam on retries of the
  // same skip.
  await db
    .update(recurringContentDefinitions)
    .set({ lastSkipNotifiedAt: now, updatedAt: now })
    .where(eq(recurringContentDefinitions.id, input.definitionId));

  await notifyRecurringBriefSkipped({
    projectId: input.projectId,
    definitionId: input.definitionId,
    definitionName: input.definitionName,
    reason: input.reason,
    ...(input.missingToolIds !== undefined && { missingToolIds: input.missingToolIds }),
    ...(input.detail !== undefined && { detail: input.detail }),
  });

  return true;
}
