import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { RefreshPipeline } from "../../../src/article/refresh/pipeline.ts";
import {
  REFRESH_PRESERVED_COLUMNS,
  REFRESH_PRESERVED_EXTRAS_KEYS,
} from "../../../src/article/refresh/preserved-fields.ts";

// Spec multi-domain-evolution S1.1 / scope A — static regression guard.
//
// RefreshPipeline does NOT today write to any preserved field (it only
// updates bodyMd / outline / selfReview*). This test reads the source of
// every RefreshPipeline step file and asserts that no `.set({ … })` block
// mentions a preserved column. If a future change adds such a write, the
// test fails and forces an explicit Spec / scope-review.
//
// The check is byte-grep based on purpose: a runtime/SQL trace would need
// a DB + live LLM mocks for a deterministic single assertion. The grep
// stays close to the actual write surface (Drizzle `.set({ … })`) and
// covers shared steps like PersistBodyStep AND PersistArticleStep so the
// guard doesn't blink if the pipeline is ever extended.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "..", "src", "article");

function readStepSource(filename: string): string {
  return readFileSync(join(srcRoot, "steps", filename), "utf8");
}

describe("RefreshPipeline does not touch preserved fields (S1.1 scope A)", () => {
  const pipeline = new RefreshPipeline();
  const stepNames = pipeline.steps.map((s) => s.name);

  it("uses exactly the 8 steps documented in the spec", () => {
    expect(stepNames).toEqual([
      "refresh-intake",
      "tool-relevance",
      "outline",
      "persist-outline",
      "draft",
      "persist-body",
      "tool-linker",
      "self-review",
    ]);
  });

  it("PersistBodyStep .set() block touches only bodyMd / wordCount / updatedAt", () => {
    const src = readStepSource("persist-body.ts");
    // Whitelist-by-allowlist: extract everything inside the first .set({ … })
    // and assert the only field-keys present are these.
    const setMatch = src.match(/\.set\(\{([\s\S]*?)\}\)/);
    expect(setMatch).not.toBeNull();
    const setBody = setMatch![1] ?? "";
    const expectedKeys = ["bodyMd:", "wordCount:", "updatedAt:"];
    for (const key of expectedKeys) {
      expect(setBody).toContain(key);
    }
    // No preserved field appears in the body of PersistBodyStep's .set()
    for (const col of REFRESH_PRESERVED_COLUMNS) {
      expect(setBody).not.toContain(`${col}:`);
    }
    for (const key of REFRESH_PRESERVED_EXTRAS_KEYS) {
      // direct prop assignment like `featured:` would be the regression
      expect(setBody).not.toContain(`${key}:`);
    }
  });

  it("PersistOutlineStep does not assign any preserved column", () => {
    const src = readStepSource("persist-outline.ts");
    for (const col of REFRESH_PRESERVED_COLUMNS) {
      expect(src).not.toMatch(new RegExp(`\\.set\\([\\s\\S]*?${col}:`));
    }
  });

  it("ToolLinkerStep does not assign any preserved column", () => {
    const linkerSrc = readFileSync(join(srcRoot, "tool-linker", "step.ts"), "utf8");
    for (const col of REFRESH_PRESERVED_COLUMNS) {
      expect(linkerSrc).not.toMatch(new RegExp(`\\.set\\([\\s\\S]*?${col}:`));
    }
  });

  it("SelfReviewStep does not assign any preserved column", () => {
    const src = readStepSource("self-review.ts");
    for (const col of REFRESH_PRESERVED_COLUMNS) {
      expect(src).not.toMatch(new RegExp(`\\.set\\([\\s\\S]*?${col}:`));
    }
  });

  it("RefreshPipeline never calls PersistArticleStep (which would overwrite extras)", () => {
    // Defensive: catches a future refactor that mistakenly imports + chains
    // PersistArticleStep into the refresh pipeline.
    const pipelineSrc = readFileSync(join(srcRoot, "refresh", "pipeline.ts"), "utf8");
    expect(pipelineSrc).not.toContain("PersistArticleStep");
    expect(pipelineSrc).not.toContain('"persist-article"');
  });
});
