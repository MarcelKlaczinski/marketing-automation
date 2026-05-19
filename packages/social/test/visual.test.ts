/**
 * Visual regression test — gated on RUN_VISUAL=1.
 *
 * Usage:
 *   RUN_VISUAL=1 bun test packages/social/test/visual.test.ts
 *
 * First run (no baselines): writes baselines to test/__baselines__/ and passes.
 * Subsequent runs: diffs against baselines; fails if any slide differs >0.1%.
 *
 * To update baselines after an intentional visual change:
 *   bun --cwd packages/social run test:visual:update
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../scripts/visual-render-all.ts");

describe("visual regression", () => {
  if (!process.env["RUN_VISUAL"]) {
    it.skip("skipped (set RUN_VISUAL=1 to enable)", () => {});
    return;
  }

  it("all templates render without diff regressions", () => {
    const result = spawnSync("bun", [SCRIPT], { encoding: "utf-8", timeout: 300_000 });
    if (result.status !== 0) {
      console.error(result.stdout); // biome-ignore lint/suspicious/noConsoleLog: test failure output
      console.error(result.stderr); // biome-ignore lint/suspicious/noConsoleLog: test failure output
    }
    expect(result.status).toBe(0);
  });
});
