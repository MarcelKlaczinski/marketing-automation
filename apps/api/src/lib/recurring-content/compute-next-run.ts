/**
 * Spec 65.5 — compute `recurring_content_definitions.next_run_at` advance.
 *
 * `frequency` is `text` validated at the HTTP boundary via
 * `frequencySchema` in `@marketing-auto/shared/recurring-content` — accepts
 * `'weekly' | 'biweekly' | 'monthly'` OR a 5/6-field cron expression. This
 * helper turns it into a concrete `Date` for the next fire.
 *
 * For named cadences we use plain UTC arithmetic (week boundary irrelevant —
 * the absolute interval is what matters). For cron expressions we use the
 * `cron-parser` library and ask for the next event AFTER `now`. The cron
 * parser is configured with `tz: "UTC"` so it does not depend on the host
 * timezone; the worker process is expected to run in UTC anyway.
 */
import { CronExpressionParser } from "cron-parser";
import { isKnownFrequency, type KnownFrequency } from "@marketing-auto/shared/recurring-content";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

/**
 * Add `months` calendar months to `date`. JS `setUTCMonth` does NOT clamp
 * day-of-month — `Jan 31 + 1 month` overflows into March because Feb only
 * has 28/29 days. We clamp explicitly: store the original day, set day to
 * 1, advance the month, then re-apply min(originalDay, lastDayOfNewMonth).
 */
function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  // Last day of the resulting month — set to day 0 of next month.
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * Compute the next `next_run_at` value for a recurring-content definition.
 *
 * @param frequency — `'weekly' | 'biweekly' | 'monthly'` or a cron expression
 * @param lastRunAt — anchor for the next fire (defaults to `now`).
 * @throws when the cron expression is malformed (the boundary schema should
 *         have caught this; the throw here is defensive)
 */
export function computeNextRun(frequency: string, lastRunAt: Date = new Date()): Date {
  if (isKnownFrequency(frequency)) {
    return advanceKnownFrequency(frequency, lastRunAt);
  }
  // Cron expression — ask the parser for the next event strictly AFTER
  // `lastRunAt`. `tz: "UTC"` keeps the cron evaluation host-timezone-independent.
  const interval = CronExpressionParser.parse(frequency, {
    currentDate: lastRunAt,
    tz: "UTC",
  });
  return interval.next().toDate();
}

function advanceKnownFrequency(frequency: KnownFrequency, anchor: Date): Date {
  switch (frequency) {
    case "weekly":
      return addDays(anchor, 7);
    case "biweekly":
      return addDays(anchor, 14);
    case "monthly":
      return addMonths(anchor, 1);
  }
}
