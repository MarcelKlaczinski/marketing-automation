/**
 * Spec 62.5: client-side ISO-8601 week helpers.
 *
 * Mirrors `packages/planner/src/iso-week.ts` (the planner pipeline uses the
 * same algorithm to compute week_start_date / week_end_date that we display
 * here). Web app can't import from workspace packages — copying the small
 * function set is simpler than wiring a path alias for one helper file.
 */

const MS_PER_DAY = 86_400_000;

/** Monday 00:00:00 UTC of (year, isoWeek). */
export function isoWeekStartDate(year: number, isoWeek: number): Date {
  if (isoWeek < 1 || isoWeek > 53) {
    throw new RangeError(`iso week out of range [1, 53]: ${isoWeek}`);
  }
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = new Date(jan4).getUTCDay();
  const isoDow = jan4Dow === 0 ? 7 : jan4Dow;
  const week1Monday = jan4 - (isoDow - 1) * MS_PER_DAY;
  return new Date(week1Monday + (isoWeek - 1) * 7 * MS_PER_DAY);
}

/** Sunday 23:59:59.999 UTC of (year, isoWeek). */
export function isoWeekEndDate(year: number, isoWeek: number): Date {
  const monday = isoWeekStartDate(year, isoWeek);
  return new Date(monday.getTime() + 6 * MS_PER_DAY + (MS_PER_DAY - 1));
}

/** Returns the (isoYear, isoWeek) of a Date. */
export function getIsoWeek(date: Date): { year: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((d.getTime() - jan1) / MS_PER_DAY) + 1;
  const isoWeek = Math.ceil(dayOfYear / 7);
  return { year, isoWeek };
}

/** Adds `days` days (UTC) and returns a new Date. */
export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** ISO-week navigation: prev/next week pair returning the new (year, isoWeek). */
export function shiftIsoWeek(
  year: number,
  isoWeek: number,
  delta: 1 | -1,
): { year: number; isoWeek: number } {
  const monday = isoWeekStartDate(year, isoWeek);
  const newMonday = addDaysUtc(monday, delta * 7);
  return getIsoWeek(newMonday);
}

/** YYYY-MM-DD for the given UTC date. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns the 7 Mon-Sun ISO dates of a (year, isoWeek). */
export function isoWeekDays(year: number, isoWeek: number): string[] {
  const monday = isoWeekStartDate(year, isoWeek);
  return Array.from({ length: 7 }, (_, i) => toIsoDate(addDaysUtc(monday, i)));
}

/** ISO day-of-week 1-7 (Mon=1) for the given date. */
export function isoDayOfWeek(d: Date): number {
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * For UI display: "25.05.2026" given a YYYY-MM-DD string.
 * Locale-aware via the `locale` arg ("de" | "en"); falls back to ISO if invalid.
 */
export function formatShortDate(isoDate: string, locale: "de" | "en"): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  if (locale === "de") {
    return d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
