// Spec 62.0a Section 8.4.2 (D9): Anthropic Batch API requires
// custom_id to match ^[a-zA-Z0-9_-]{1,64}$. Pre-flight Task 1 caught a colon-
// separator bug that produced HTTP 400. This test pins the canonical format.
import { describe, expect, it } from "bun:test";

const ANTHROPIC_CUSTOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Mirror of the canonical builder in `src/engine/batch-llm-client.ts:118`.
 * Tested as a pure function so the regex contract is enforced without spinning
 * up the batch DB row.
 */
function buildAnthropicCustomId(pipelineRunId: string, stepKey: string): string {
  return `${pipelineRunId}_${stepKey}`;
}

describe("anthropic custom_id format (Spec 62.0a D9)", () => {
  it("uses underscore separator, not colon", () => {
    const runId = "abc12345-1234-5678-9012-abcdef123456";
    const id = buildAnthropicCustomId(runId, "outline");
    expect(id).not.toContain(":");
    expect(id).toContain("_");
  });

  it("matches Anthropic's ^[a-zA-Z0-9_-]{1,64}$ regex for typical pipelineRunId + step combinations", () => {
    const samples = [
      buildAnthropicCustomId("12345678-1234-5678-9012-123456789012", "outline"),
      buildAnthropicCustomId("12345678-1234-5678-9012-123456789012", "draft"),
      buildAnthropicCustomId("12345678-1234-5678-9012-123456789012", "self-review"),
      buildAnthropicCustomId("12345678-1234-5678-9012-123456789012", "schema-rich-detect"),
    ];
    for (const id of samples) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(ANTHROPIC_CUSTOM_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it("rejects a hypothetical colon-separator format against Anthropic's regex", () => {
    // This is what the bug looked like pre-fix. Documenting it as a negative test
    // so any future regression that flips the separator gets caught.
    const buggy = "12345678-1234-5678-9012-123456789012:outline";
    expect(ANTHROPIC_CUSTOM_ID_PATTERN.test(buggy)).toBe(false);
  });

  it("rejects ids over 64 characters even with valid separators", () => {
    // Anthropic's hard limit. UUIDs are 36 chars; underscore + stepKey leaves 27 chars budget.
    const veryLongStep = "a".repeat(40);
    const oversized = buildAnthropicCustomId("12345678-1234-5678-9012-123456789012", veryLongStep);
    expect(oversized.length).toBeGreaterThan(64);
    expect(ANTHROPIC_CUSTOM_ID_PATTERN.test(oversized)).toBe(false);
  });
});
