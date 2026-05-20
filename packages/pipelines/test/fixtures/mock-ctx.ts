// Spec 62.0a-followup Issue 6: centralised StepContext factory for tests.
//
// Why this exists: every required field added to `StepContext` (e.g. `llmMode` in
// Spec 61.4, `runMode` in Spec 62.0a) used to break every `mockCtx` literal in the
// workspace — 11 sites across packages/pipelines, packages/adapters/astro-sync, and
// apps/api. The factory defaults all required fields so future additions only need
// to update this file plus any test that explicitly cares about the new field.
//
// Conventions for callers:
// - Override only the fields you actually need (`makeMockCtx({ projectId: realId })`).
// - For tests that need a stable projectId across multiple ctx calls, pass it in.
// - The fixture uses `createLogger("test")` so log output is suppressed unless
//   the test enables it via Pino's standard env vars.
//
// Cross-package use: importing from `@marketing-auto/pipelines/test-fixtures` is
// not supported (test/ is not in the package's exports map by design). Cross-
// package tests (e.g. packages/adapters/astro-sync) should define a thin local
// wrapper that copies the defaults; the wrapper file points back here in a comment.
import { createLogger } from "@marketing-auto/shared";
import type { StepContext } from "../../src/engine/step.ts";

/**
 * Default StepContext for unit tests. All required fields are filled with sensible
 * defaults so tests can override only what they care about.
 */
function defaultMockCtx(): StepContext {
  return {
    projectId: "00000000-0000-0000-0000-000000000001",
    pipelineRunId: crypto.randomUUID(),
    stepRunId: crypto.randomUUID(),
    pipelineName: "test",
    llmMode: "sync",
    runMode: "production",
    log: createLogger("test"),
    reportProgress: async () => {},
    getStepOutput: () => undefined,
  };
}

/**
 * Build a `StepContext` for use in unit tests. Override any default by passing it
 * in `overrides`. Adding a new required field to `StepContext` only requires
 * updating `defaultMockCtx()` above — no test churn.
 */
export function makeMockCtx(overrides: Partial<StepContext> = {}): StepContext {
  return { ...defaultMockCtx(), ...overrides };
}
