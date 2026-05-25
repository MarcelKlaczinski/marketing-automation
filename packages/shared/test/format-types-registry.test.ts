/**
 * Spec 65.1 + 65.4 — format-types registry unit tests.
 *
 * Pins the permissive-fallback contract + the test-only register/unregister
 * helpers shipped in 65.1, plus the populated-registry contract from 65.4
 * (5 v1 format-types registered at module init).
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

describe("format-types registry (Spec 65.1 skeleton + 65.4 population)", () => {
  afterEach(() => {
    __unregisterFormatTypeForTest("test-format");
  });

  it("has the 5 v1 format-types registered at module init (Spec 65.4)", () => {
    expect(FORMAT_TYPES.top_n_comparison).toBeDefined();
    expect(FORMAT_TYPES.head_to_head).toBeDefined();
    expect(FORMAT_TYPES.story_arc_clickbait).toBeDefined();
    expect(FORMAT_TYPES.lifestyle_listicle).toBeDefined();
    expect(FORMAT_TYPES.opinion_recommendation).toBeDefined();
  });

  it("test-format is not in the registry between runs", () => {
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
        needsHooks: false,
        defaultEndSlides: [],
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
        needsHooks: true,
        defaultEndSlides: [],
      });
      expect(FORMAT_TYPES["test-format"]).toBeDefined();
      __unregisterFormatTypeForTest("test-format");
      expect(FORMAT_TYPES["test-format"]).toBeUndefined();
    });
  });
});
