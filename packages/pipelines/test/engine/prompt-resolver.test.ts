// Spec 62.0a + 62.0b unit tests for resolvePrompt.
// Note: in 62.0b the resolver became async and hits the DB on Tier 2 + Tier 3 lookups.
// These tests use an all-zero projectId for which no goldens exist, so both DB tiers
// return null and the resolver falls through to the file default. The hybrid-resolution
// order (project-golden / global-golden vs file default) has its own integration test
// in step-pause-resume.test.ts (Scenario 13).
import { afterEach, describe, expect, it } from "bun:test";
import { resolvePrompt } from "../../src/engine/prompt-resolver.ts";
import { clearGoldenPromptCacheForTesting } from "../../src/engine/golden-prompt-cache.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const baseCtx = (override?: Record<string, string>) =>
  makeMockCtx({
    projectId: "00000000-0000-0000-0000-000000000000",
    pipelineRunId: "00000000-0000-0000-0000-000000000000",
    stepRunId: "00000000-0000-0000-0000-000000000000",
    ...(override !== undefined ? { promptOverride: override } : {}),
  });

afterEach(() => {
  // Drop the negative-cache entries written by the "no override" tests so each test
  // starts from a clean slate.
  clearGoldenPromptCacheForTesting();
});

describe("resolvePrompt", () => {
  it("returns the default when no override is set", async () => {
    const result = await resolvePrompt(baseCtx(), "step-a", () => "default-prompt");
    expect(result).toBe("default-prompt");
  });

  it("returns the override when set for the matching step name", async () => {
    const result = await resolvePrompt(
      baseCtx({ "step-a": "custom-prompt" }),
      "step-a",
      () => "default-prompt"
    );
    expect(result).toBe("custom-prompt");
  });

  it("does NOT match an override keyed under a different step name", async () => {
    const result = await resolvePrompt(
      baseCtx({ "step-b": "custom-prompt" }),
      "step-a",
      () => "default-for-a"
    );
    expect(result).toBe("default-for-a");
  });

  it("calls the default builder only when override is unset (lazy evaluation)", async () => {
    let calls = 0;
    const build = () => {
      calls += 1;
      return "expensive-default";
    };

    // Override path: builder must NOT run.
    await resolvePrompt(baseCtx({ "step-a": "fast-override" }), "step-a", build);
    expect(calls).toBe(0);

    // Default path: builder runs once.
    await resolvePrompt(baseCtx(), "step-a", build);
    expect(calls).toBe(1);
  });

  it("treats an empty-string override as a valid value (NOT a 'use default' signal)", async () => {
    const result = await resolvePrompt(baseCtx({ "step-a": "" }), "step-a", () => "default");
    expect(result).toBe("");
  });
});
