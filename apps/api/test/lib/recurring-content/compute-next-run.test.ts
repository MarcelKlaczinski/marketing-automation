/**
 * Spec 65.5 — compute-next-run pure unit tests.
 */
import { describe, expect, it } from "bun:test";
import { computeNextRun } from "../../../src/lib/recurring-content/compute-next-run.ts";

describe("computeNextRun (Spec 65.5)", () => {
  const anchor = new Date("2026-01-01T00:00:00.000Z");

  it("advances 7 days for 'weekly'", () => {
    const next = computeNextRun("weekly", anchor);
    expect(next.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("advances 14 days for 'biweekly'", () => {
    const next = computeNextRun("biweekly", anchor);
    expect(next.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("advances 1 month for 'monthly'", () => {
    const next = computeNextRun("monthly", anchor);
    expect(next.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("clamps Jan 31 + 1 month to Feb 28 (non-leap)", () => {
    // Spec says 2026 (not leap), so Jan 31 + 1 month → Feb 28.
    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    const next = computeNextRun("monthly", jan31);
    expect(next.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("parses a 5-field cron expression", () => {
    // "0 * * * *" = every hour at minute 0.
    const next = computeNextRun("0 * * * *", new Date("2026-01-01T12:30:00.000Z"));
    expect(next.toISOString()).toBe("2026-01-01T13:00:00.000Z");
  });

  it("parses a weekday-restricted cron (Mon 09:00 UTC)", () => {
    // 2026-01-01 is Thursday; next Mon 09:00 UTC = 2026-01-05.
    const next = computeNextRun("0 9 * * 1", anchor);
    expect(next.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("throws on malformed cron expression", () => {
    expect(() => computeNextRun("not a cron", anchor)).toThrow();
  });

  it("defaults lastRunAt to now when omitted", () => {
    const before = Date.now();
    const next = computeNextRun("weekly");
    const after = Date.now();
    // Should be ~7 days from now (allow 1s tolerance for test execution time).
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 1000);
    expect(next.getTime()).toBeLessThanOrEqual(after + 7 * 86_400_000 + 1000);
  });
});
