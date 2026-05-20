// Spec 62.0a Section 4.4 unit tests for resolvePrompt.
import { describe, expect, it } from "bun:test";
import { resolvePrompt } from "../../src/engine/prompt-resolver.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const baseCtx = (override?: Record<string, string>) =>
  makeMockCtx({
    projectId: "00000000-0000-0000-0000-000000000000",
    pipelineRunId: "00000000-0000-0000-0000-000000000000",
    stepRunId: "00000000-0000-0000-0000-000000000000",
    ...(override !== undefined ? { promptOverride: override } : {}),
  });

describe("resolvePrompt", () => {
  it("returns the default when no override is set", () => {
    const result = resolvePrompt(baseCtx(), "step-a", () => "default-prompt");
    expect(result).toBe("default-prompt");
  });

  it("returns the override when set for the matching step name", () => {
    const result = resolvePrompt(
      baseCtx({ "step-a": "custom-prompt" }),
      "step-a",
      () => "default-prompt"
    );
    expect(result).toBe("custom-prompt");
  });

  it("does NOT match an override keyed under a different step name", () => {
    const result = resolvePrompt(
      baseCtx({ "step-b": "custom-prompt" }),
      "step-a",
      () => "default-for-a"
    );
    expect(result).toBe("default-for-a");
  });

  it("calls the default builder only when override is unset (lazy evaluation)", () => {
    let calls = 0;
    const build = () => {
      calls += 1;
      return "expensive-default";
    };

    // Override path: builder must NOT run.
    resolvePrompt(baseCtx({ "step-a": "fast-override" }), "step-a", build);
    expect(calls).toBe(0);

    // Default path: builder runs once.
    resolvePrompt(baseCtx(), "step-a", build);
    expect(calls).toBe(1);
  });

  it("treats an empty-string override as a valid value (NOT a 'use default' signal)", () => {
    const result = resolvePrompt(baseCtx({ "step-a": "" }), "step-a", () => "default");
    expect(result).toBe("");
  });
});
