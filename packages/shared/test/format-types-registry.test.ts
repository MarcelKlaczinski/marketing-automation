/**
 * Spec 65.1 — format-types registry skeleton unit tests.
 *
 * The registry ships empty in 65.1 (populated in 65.4). These tests pin the
 * permissive-fallback contract + the test-only register/unregister helpers.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  FORMAT_TYPES,
  __registerFormatTypeForTest,
  __unregisterFormatTypeForTest,
  getFormatTypeSchema,
  validateFormatConfig,
} from "../src/format-types/index.ts";

describe("format-types registry skeleton (Spec 65.1)", () => {
  afterEach(() => {
    __unregisterFormatTypeForTest("test-format");
  });

  it("starts effectively empty (registry skeleton)", () => {
    // Other test files may register types; assert the test-format isn't there.
    expect(FORMAT_TYPES["test-format"]).toBeUndefined();
  });

  describe("permissive fallback for unknown format-types", () => {
    it("getFormatTypeSchema returns a passthrough record schema", () => {
      const schema = getFormatTypeSchema("unregistered");
      const result = schema.safeParse({ anything: "goes", count: 3 });
      expect(result.success).toBe(true);
    });

    it("validateFormatConfig returns ok=true for any object", () => {
      const r = validateFormatConfig("unregistered", { foo: "bar" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data).toEqual({ foo: "bar" });
    });

    it("permissive validator rejects non-object input (z.record requires an object)", () => {
      const r = validateFormatConfig("unregistered", "not-an-object");
      expect(r.ok).toBe(false);
    });
  });

  describe("registered format-types use the registered schema", () => {
    it("strict schema rejects bad shape", () => {
      __registerFormatTypeForTest("test-format", {
        family: "A",
        configSchema: z.object({ count: z.number().int().min(1).max(10) }),
        briefGenerator: "fake.test.generator",
        eligibleTemplates: [],
      });
      const ok = validateFormatConfig("test-format", { count: 5 });
      expect(ok.ok).toBe(true);

      const bad = validateFormatConfig("test-format", { count: 99 });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/count/);
    });

    it("__unregisterFormatTypeForTest cleans the registry", () => {
      __registerFormatTypeForTest("test-format", {
        family: "B",
        configSchema: z.string(),
        briefGenerator: "noop",
        eligibleTemplates: [],
      });
      expect(FORMAT_TYPES["test-format"]).toBeDefined();
      __unregisterFormatTypeForTest("test-format");
      expect(FORMAT_TYPES["test-format"]).toBeUndefined();
    });
  });
});
