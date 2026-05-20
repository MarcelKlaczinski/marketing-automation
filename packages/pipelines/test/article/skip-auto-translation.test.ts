// Spec 62.0a-followup Issue 1: unit tests for the auto-translation skip gate.
import { describe, expect, it } from "bun:test";
import { shouldSkipAutoTranslation } from "../../src/article/translation/skip-gate.ts";

describe("shouldSkipAutoTranslation", () => {
  const NOW = new Date("2026-05-20T12:00:00Z");

  it("returns false when skipAutoTranslationUntil is null", () => {
    expect(shouldSkipAutoTranslation(null, NOW)).toBe(false);
  });

  it("returns true when skipAutoTranslationUntil is in the future", () => {
    const future = new Date("2026-05-27T12:00:00Z"); // +7 days
    expect(shouldSkipAutoTranslation(future, NOW)).toBe(true);
  });

  it("returns false when skipAutoTranslationUntil is in the past", () => {
    const past = new Date("2026-05-19T12:00:00Z"); // -1 day
    expect(shouldSkipAutoTranslation(past, NOW)).toBe(false);
  });

  it("returns false when skipAutoTranslationUntil equals now", () => {
    // Boundary case: the skip window has just expired. Treat as expired (do not skip).
    expect(shouldSkipAutoTranslation(NOW, NOW)).toBe(false);
  });

  it("defaults the clock to new Date() when not provided", () => {
    const past = new Date(Date.now() - 60_000);
    expect(shouldSkipAutoTranslation(past)).toBe(false);
    const future = new Date(Date.now() + 60_000);
    expect(shouldSkipAutoTranslation(future)).toBe(true);
  });
});
