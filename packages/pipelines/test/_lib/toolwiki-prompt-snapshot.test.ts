/**
 * Spec multi-domain-evolution §4 Cross-Sprint snapshot regression test.
 *
 * Locks in byte-equivalence between the live 9 Toolwiki-biased prompt
 * sources and the baseline captured in
 * `__tests__/snapshots/baseline-toolwiki-prompts.json` (committed at the
 * start of Sprint 1).
 *
 * Diff policy (from the baseline `_meta.diffPolicy`):
 *   - Sprint 1-3: source-file SHA-1 must match the recorded SHA exactly
 *     (no template refactor allowed yet)
 *   - Sprint 4+: SHA may drift (S4.4 swapped hardcoded strings to
 *     `${tenantVars.X}` template interpolations) BUT every Toolwiki-
 *     resolved prompt must STILL contain every substring in
 *     `mustContainSubstrings` — that's the byte-equivalent contract
 *
 * This test runs the Sprint-4+ branch of the policy: it reads each source
 * file, substitutes every `${tenantVars.X}` reference with the Toolwiki
 * value from `NICHE_PROMPT_VARS["ai-tool-wiki"]`, and asserts every
 * `mustContainSubstrings` entry appears in the substituted text. A future
 * developer who accidentally removes "You are writing the FULL DRAFT of
 * an article for toolwiki.ai" (e.g. by reformatting the template literal
 * or renaming a tenantVars field) sees a loud failure here instead of
 * silent prompt drift surfacing weeks later in worse LLM output.
 *
 * The test does NOT invoke the actual builder functions — that would
 * require a full StepContext + DB + project fixture. The source-text
 * substitution approach is the 80/20 win: catches every drift class the
 * spec calls out (removal, rename, refactor) with no runtime ceremony.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tenantPromptVarsForNiche, type TenantPromptVars } from "../../src/_lib/tenant-prompt-vars.ts";

interface PromptSourceBaseline {
  id: string;
  file: string;
  sha1: string;
  bytes: number;
  anchorLines: number[];
  mustContainSubstrings: string[];
  templateCount?: number;
  templateNames?: string[];
  notes?: string;
}

interface BaselineSnapshot {
  _meta: {
    spec: string;
    branch: string;
    createdAt: string;
    purpose: string;
    diffPolicy: string;
    toolwikiProjectSlug: string;
  };
  promptSources: PromptSourceBaseline[];
}

// Repo root resolved relative to this file (packages/pipelines/test/_lib).
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const BASELINE_PATH = resolve(
  REPO_ROOT,
  "__tests__/snapshots/baseline-toolwiki-prompts.json",
);

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as BaselineSnapshot;

const TOOLWIKI_VARS = tenantPromptVarsForNiche("ai-tool-wiki", "toolwiki.ai");

/**
 * Substitutes every `${tenantVars.<field>}` reference in the source text
 * with the Toolwiki value. Mirrors how the live LLM call resolves the
 * template at runtime — except we operate on the raw source text, no
 * builder invocation needed.
 *
 * Uses literal string split/join (not RegExp) because the template tokens
 * contain `${...}` characters that would need escaping in a RegExp anyway,
 * and split/join is both faster and easier to reason about.
 */
function resolveSourceForToolwiki(src: string, vars: TenantPromptVars): string {
  let resolved = src;
  for (const [field, value] of Object.entries(vars)) {
    resolved = resolved.split(`\${tenantVars.${field}}`).join(value);
  }
  return resolved;
}

describe("Toolwiki prompt snapshot regression (Spec multi-domain-evolution §4)", () => {
  it("baseline file is non-empty + has unique IDs", () => {
    // The baseline currently tracks 8 prompt sources (S4.4 commit f75c31c
    // deleted the dead `packages/pipelines/src/article/social-image/hookPrompt.ts`;
    // its live counterpart `packages/core/src/social-hooks/hookPrompt.ts`
    // replaces it under the same `social-image-hook-templates` id).
    expect(baseline.promptSources.length).toBeGreaterThan(0);
    const ids = baseline.promptSources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  // Generate one `it` per source so a single drift surfaces as a single
  // failing test, not a sea of failures inside one `it`.
  for (const source of baseline.promptSources) {
    it(`${source.id} — resolved prompt contains all baseline mustContainSubstrings`, () => {
      const filePath = resolve(REPO_ROOT, source.file);
      const fileText = readFileSync(filePath, "utf-8");
      const resolved = resolveSourceForToolwiki(fileText, TOOLWIKI_VARS);

      // Build a per-source breadcrumb so a failure tells you which file
      // to look at, not just which assertion line in the test.
      const missing = source.mustContainSubstrings.filter(
        (substr) => !resolved.includes(substr),
      );
      if (missing.length > 0) {
        const summary = missing.map((s) => `  • ${JSON.stringify(s)}`).join("\n");
        throw new Error(
          `Toolwiki prompt drift in ${source.file} (${source.id}):\n` +
            `${missing.length} of ${source.mustContainSubstrings.length} baseline substring(s) missing from the Toolwiki-resolved source:\n${summary}\n` +
            `Either restore the missing string OR update __tests__/snapshots/baseline-toolwiki-prompts.json + add a §12 deviation entry in docs/specs/multi-domain-evolution/spec.md.`,
        );
      }

      expect(missing.length).toBe(0);
    });
  }

  it("Toolwiki tenant vars resolve to expected baseline values", () => {
    // Sanity-check: the tenantVars values used for substitution above
    // are the canonical Toolwiki strings. If a future commit changes
    // NICHE_PROMPT_VARS["ai-tool-wiki"].domain from "toolwiki.ai" to
    // anything else, this test fails before the substitution test does,
    // making the root cause obvious in CI logs.
    expect(TOOLWIKI_VARS.domain).toBe("toolwiki.ai");
    expect(TOOLWIKI_VARS.socialHookNiche).toBe("AI tools niche");
    expect(TOOLWIKI_VARS.nicheGermanKeyword).toBe("KI-Tools");
    expect(TOOLWIKI_VARS.nicheScopeShort).toBe("AI/ML");
  });
});
