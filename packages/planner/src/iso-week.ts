// Spec 62.4: ISO-8601 week-date helpers for PlanWeekPipeline.
//
// Hand-rolled (no date-fns dep) because the algorithm is small, well-defined,
// and we only need three operations: get the (year, isoWeek) of a date, and
// compute the Monday/Sunday boundaries of a given ISO week. Verified against
// the canonical examples from ISO-8601 §5.1.4.

const MS_PER_DAY = 86_400_000;

/**
 * Returns the UTC Date for Monday of (year, isoWeek) at 00:00:00Z.
 *
 * ISO-8601: week 1 of a year contains the first Thursday of that year. So
 * Monday of week 1 = the Monday on-or-before that Thursday.
 */
export function isoWeekStartDate(year: number, isoWeek: number): Date {
  if (isoWeek < 1 || isoWeek > 53) {
    throw new RangeError(`iso week out of range [1, 53]: ${isoWeek}`);
  }
  // Jan 4 is always in ISO week 1. Find the Monday of that week.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = new Date(jan4).getUTCDay(); // 0=Sun..6=Sat
  // Mon=1, Sun=7 in ISO; convert: dow=0 means Sun=7, others stay.
  const isoDow = jan4Dow === 0 ? 7 : jan4Dow;
  const week1Monday = jan4 - (isoDow - 1) * MS_PER_DAY;
  return new Date(week1Monday + (isoWeek - 1) * 7 * MS_PER_DAY);
}

/** Returns Sunday 23:59:59.999Z of (year, isoWeek). */
export function isoWeekEndDate(year: number, isoWeek: number): Date {
  const monday = isoWeekStartDate(year, isoWeek);
  return new Date(monday.getTime() + 6 * MS_PER_DAY + (MS_PER_DAY - 1));
}

/** Returns the (isoYear, isoWeek) of a Date (UTC-based). */
export function getIsoWeek(date: Date): { year: number; isoWeek: number } {
  // Use UTC throughout to avoid TZ drift.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to Thursday of the same ISO week (defines the year).
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((d.getTime() - jan1) / MS_PER_DAY) + 1;
  const isoWeek = Math.ceil(dayOfYear / 7);
  return { year, isoWeek };
}

/** Adds `days` days to a Date (UTC-based) and returns a new Date. */
export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}
