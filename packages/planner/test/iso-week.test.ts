// Spec 62.4: ISO-week helper unit tests.
// Pure function tests — no DB.

import { describe, expect, it } from "bun:test";
import {
  addDaysUtc,
  computeNextIsoWeek,
  getIsoWeek,
  isoWeekEndDate,
  isoWeekStartDate,
} from "../src/index.ts";

describe("isoWeekStartDate", () => {
  it("returns Monday 00:00:00Z of (2026, KW22) = 2026-05-25", () => {
    expect(isoWeekStartDate(2026, 22).toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });

  it("handles the year-boundary case (2025 KW1 = 2024-12-30)", () => {
    // Jan 1 2025 is Wednesday → ISO week 1 starts Monday Dec 30 2024.
    expect(isoWeekStartDate(2025, 1).toISOString()).toBe("2024-12-30T00:00:00.000Z");
  });

  it("handles long-year KW53 (2020 had KW53)", () => {
    // 2020 was a 53-week ISO year. KW53 starts 2020-12-28.
    expect(isoWeekStartDate(2020, 53).toISOString()).toBe("2020-12-28T00:00:00.000Z");
  });

  it("throws when isoWeek is out of range", () => {
    expect(() => isoWeekStartDate(2026, 0)).toThrow(/out of range/);
    expect(() => isoWeekStartDate(2026, 54)).toThrow(/out of range/);
  });
});

describe("isoWeekEndDate", () => {
  it("returns Sunday 23:59:59.999Z six days after the Monday", () => {
    expect(isoWeekEndDate(2026, 22).toISOString()).toBe("2026-05-31T23:59:59.999Z");
  });
});

describe("getIsoWeek", () => {
  it("round-trips KW22 of 2026", () => {
    const monday = isoWeekStartDate(2026, 22);
    expect(getIsoWeek(monday)).toEqual({ year: 2026, isoWeek: 22 });
  });

  it("identifies 2024-12-31 as KW1 of 2025", () => {
    expect(getIsoWeek(new Date("2024-12-31T00:00:00.000Z"))).toEqual({ year: 2025, isoWeek: 1 });
  });

  it("identifies 2025-01-01 as KW1 of 2025", () => {
    expect(getIsoWeek(new Date("2025-01-01T00:00:00.000Z"))).toEqual({ year: 2025, isoWeek: 1 });
  });
});

describe("addDaysUtc", () => {
  it("adds days without losing time-of-day precision", () => {
    const base = new Date("2026-05-25T00:00:00.000Z");
    expect(addDaysUtc(base, 6).toISOString()).toBe("2026-05-31T00:00:00.000Z");
  });
});

// Spec 62.7: cron handler computes next-week's (year, isoWeek) regardless of
// which weekday the cron fires on. Edge cases below.
describe("computeNextIsoWeek", () => {
  it("returns +1 ISO week when called mid-week", () => {
    // Wednesday 2026-05-27 (KW22 Wed) → next Monday is 2026-06-01 (KW23).
    const wed = new Date("2026-05-27T12:00:00.000Z");
    expect(computeNextIsoWeek(wed)).toEqual({ year: 2026, isoWeek: 23 });
  });

  it("returns +1 ISO week when called on a Sunday", () => {
    // Sunday 2026-05-24 (KW21 Sun, the last day of KW21) → next Monday is
    // 2026-05-25 → KW22. The function returns next-week-from-this-week-Monday,
    // so even on Sunday we advance to the *following* Monday.
    const sun = new Date("2026-05-24T23:00:00.000Z");
    expect(computeNextIsoWeek(sun)).toEqual({ year: 2026, isoWeek: 22 });
  });

  it("returns +1 ISO week when called on a Monday at 00:00:00Z", () => {
    // Monday 2026-05-25 (KW22 Mon) → next Monday is 2026-06-01 (KW23).
    const mon = new Date("2026-05-25T00:00:00.000Z");
    expect(computeNextIsoWeek(mon)).toEqual({ year: 2026, isoWeek: 23 });
  });

  it("crosses ISO-year boundary at end of 2024", () => {
    // Sunday 2024-12-29 → next Monday is 2024-12-30 → KW1 of 2025.
    const sun = new Date("2024-12-29T12:00:00.000Z");
    expect(computeNextIsoWeek(sun)).toEqual({ year: 2025, isoWeek: 1 });
  });

  it("crosses into the last-week-of-prior-year (KW53)", () => {
    // 2020 had KW53. Sunday 2020-12-20 (KW51 Sun) → next Monday 2020-12-21
    // → KW52. Wednesday 2020-12-23 (KW52 Wed) → next Monday 2020-12-28 → KW53.
    const wed = new Date("2020-12-23T12:00:00.000Z");
    expect(computeNextIsoWeek(wed)).toEqual({ year: 2020, isoWeek: 53 });
  });

  it("computes from the now Monday, not from the moment", () => {
    // Late Friday 2026-05-29 23:59 → next Monday is 2026-06-01 → KW23.
    const fri = new Date("2026-05-29T23:59:59.999Z");
    expect(computeNextIsoWeek(fri)).toEqual({ year: 2026, isoWeek: 23 });
  });
});
