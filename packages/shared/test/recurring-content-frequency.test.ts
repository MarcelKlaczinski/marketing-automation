/**
 * Spec 65.1 — frequencySchema unit tests.
 */
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PERSONAS,
  frequencySchema,
  isKnownFrequency,
} from "../src/recurring-content/index.ts";

describe("frequencySchema (Spec 65.1)", () => {
  describe("known frequencies", () => {
    it("accepts weekly|biweekly|monthly", () => {
      expect(frequencySchema.parse("weekly")).toBe("weekly");
      expect(frequencySchema.parse("biweekly")).toBe("biweekly");
      expect(frequencySchema.parse("monthly")).toBe("monthly");
    });

    it("isKnownFrequency narrows the type", () => {
      expect(isKnownFrequency("weekly")).toBe(true);
      expect(isKnownFrequency("daily")).toBe(false);
      expect(isKnownFrequency("0 9 * * *")).toBe(false);
    });
  });

  describe("cron expressions", () => {
    it("accepts 5-field cron (minute hour day month dow)", () => {
      expect(frequencySchema.parse("0 9 * * *")).toBe("0 9 * * *");
      expect(frequencySchema.parse("*/15 * * * 1-5")).toBe("*/15 * * * 1-5");
      expect(frequencySchema.parse("0 0 1 1 *")).toBe("0 0 1 1 *");
    });

    it("accepts 6-field cron (seconds + 5)", () => {
      expect(frequencySchema.parse("0 0 9 * * 1")).toBe("0 0 9 * * 1");
    });

    it("tolerates Quartz `?` field marker", () => {
      expect(frequencySchema.parse("0 0 9 ? * MON")).toBe("0 0 9 ? * MON");
    });
  });

  describe("rejections", () => {
    it("rejects empty string", () => {
      expect(() => frequencySchema.parse("")).toThrow();
    });

    it("rejects unknown literal", () => {
      expect(() => frequencySchema.parse("hourly")).toThrow();
    });

    it("rejects field counts other than 5 or 6", () => {
      expect(() => frequencySchema.parse("9 * * *")).toThrow(); // 4 fields
      expect(() => frequencySchema.parse("0 0 0 9 * * 1")).toThrow(); // 7 fields
    });

    it("rejects field containing illegal characters", () => {
      expect(() => frequencySchema.parse("$$$ * * * *")).toThrow();
    });
  });
});

describe("DEFAULT_PERSONAS (Spec 65.1)", () => {
  it("has 15 entries", () => {
    // Spec 65.3 widened the v1 set from 10 → 15 (added translators, musicians,
    // craftsmen, consultants, researchers); test assertion was missed in that
    // commit and surfaced during Spec 65.cleanup Phase 5 verification.
    expect(DEFAULT_PERSONAS).toHaveLength(15);
  });

  it("contains the v1 set", () => {
    expect(DEFAULT_PERSONAS).toContain("beginners");
    expect(DEFAULT_PERSONAS).toContain("developers");
    expect(DEFAULT_PERSONAS).toContain("creators");
  });
});
