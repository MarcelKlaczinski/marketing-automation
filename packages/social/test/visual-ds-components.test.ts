/**
 * Visual regression tests for DS shared components (Spec 60.0b v2).
 * Gated on RUN_VISUAL=1 — same convention as visual.test.ts (Spec 59.3.5).
 *
 * Usage:
 *   RUN_VISUAL=1 bun test packages/social/test/visual-ds-components.test.ts
 *
 * Baselines are committed to test/__baselines__/ds-components/ (11 PNGs, stable renders).
 * To regenerate: delete the directory and re-run with RUN_VISUAL=1.
 *
 * Threshold: 0.1% pixel diff (matches Spec 59.3.5 convention).
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../scripts/visual-render-ds-components.ts");

describe("visual regression — DS components", () => {
  if (!process.env["RUN_VISUAL"]) {
    it.skip("skipped (set RUN_VISUAL=1 to enable)", () => {});
    return;
  }

  it("DsGlow renders without diff regressions", () => {
    const result = spawnSync("bun", [SCRIPT, "--component=DsGlow"], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      console.error(result.stdout); // biome-ignore lint/suspicious/noConsoleLog: test failure output
      console.error(result.stderr); // biome-ignore lint/suspicious/noConsoleLog: test failure output
    }
    expect(result.status).toBe(0);
  });

  it("DsTop renders without diff regressions", () => {
    const result = spawnSync("bun", [SCRIPT, "--component=DsTop"], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      console.error(result.stdout); // biome-ignore lint/suspicious/noConsoleLog: test failure output
      console.error(result.stderr); // biome-ignore lint/suspicious/noConsoleLog: test failure output
    }
    expect(result.status).toBe(0);
  });

  it("DsFoot renders without diff regressions", () => {
    const result = spawnSync("bun", [SCRIPT, "--component=DsFoot"], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      console.error(result.stdout); // biome-ignore lint/suspicious/noConsoleLog: test failure output
      console.error(result.stderr); // biome-ignore lint/suspicious/noConsoleLog: test failure output
    }
    expect(result.status).toBe(0);
  });
});
