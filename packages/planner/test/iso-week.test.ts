// Spec 62.4: ISO-week helper unit tests.
// Pure function tests — no DB.

import { describe, expect, it } from "bun:test";
import { addDaysUtc, getIsoWeek, isoWeekEndDate, isoWeekStartDate } from "../src/index.ts";

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
