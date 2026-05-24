// Spec 64.19 follow-up — smoke-level surface test so the `bun test` runner
// finds at least one test file. Live behaviour is covered indirectly by
// pipeline integration tests in apps/api.

import { describe, expect, it } from "bun:test";
import {
  PageSpeedValidationPipeline,
  PageSpeedApiValidationPipeline,
  PagespeedError,
} from "../src/index.ts";

describe("pagespeed adapter — public surface", () => {
  it("exports both validation pipeline classes", () => {
    expect(typeof PageSpeedValidationPipeline).toBe("function");
    expect(typeof PageSpeedApiValidationPipeline).toBe("function");
  });

  it("PagespeedError carries stage + originalCause and is an Error", () => {
    // Constructor signature renames `cause` → `originalCause` per root CLAUDE.md.
    const inner = new Error("inner");
    const err = new PagespeedError("boom", "build", inner);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.stage).toBe("build");
    expect(err.originalCause).toBe(inner);
    expect(err.name).toBe("PagespeedError");
  });

  it("pipeline instances have a name + steps array", () => {
    const p1 = new PageSpeedValidationPipeline();
    expect(typeof p1.name).toBe("string");
    expect(Array.isArray(p1.steps)).toBe(true);

    const p2 = new PageSpeedApiValidationPipeline();
    expect(typeof p2.name).toBe("string");
    expect(Array.isArray(p2.steps)).toBe(true);
  });
});
