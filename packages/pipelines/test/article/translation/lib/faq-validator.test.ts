import { describe, expect, it } from "bun:test";
import {
  countFaqItems,
  validateFaqPreservation,
} from "../../../../src/article/translation/lib/faq-validator.ts";

describe("countFaqItems (Spec 64.4)", () => {
  it("returns 0 when no FAQ section present", () => {
    expect(countFaqItems("# Article\n\n## Conclusion\n\nDone.\n")).toBe(0);
  });

  it("counts H3 items under '## FAQ' section only (not later sections)", () => {
    const body = [
      "# Article",
      "## FAQ",
      "### What is X?",
      "Answer A.",
      "### What is Y?",
      "Answer B.",
      "### What is Z?",
      "Answer C.",
      "## Conclusion",
      "### Not a FAQ",
      "This shouldn't count.",
    ].join("\n");
    expect(countFaqItems(body)).toBe(3);
  });

  it("counts H3 items under '## Häufige Fragen' (German)", () => {
    const body = "## Häufige Fragen\n### Frage 1?\n\n### Frage 2?\n";
    expect(countFaqItems(body)).toBe(2);
  });

  it("counts H3 items under '## FAQs' (English plural)", () => {
    const body = "## FAQs\n### Q1\n### Q2\n### Q3\n### Q4\n";
    expect(countFaqItems(body)).toBe(4);
  });

  it("counts H3 items under '## Frequently Asked Questions'", () => {
    const body = "## Frequently Asked Questions\n### What?\n### Why?\n";
    expect(countFaqItems(body)).toBe(2);
  });
});

describe("validateFaqPreservation (Spec 64.4)", () => {
  it("returns valid when counts match", () => {
    const source = "## FAQ\n### Q1\n### Q2\n";
    const target = "## FAQ\n### A1\n### A2\n";
    const result = validateFaqPreservation(source, target);
    expect(result.valid).toBe(true);
    expect(result.delta).toBe(0);
    expect(result.sourceCount).toBe(2);
    expect(result.targetCount).toBe(2);
    expect(result.message).toMatch(/preserved/);
  });

  it("reports asymmetry when target has fewer items (lost)", () => {
    const source = "## Häufige Fragen\n### F1\n### F2\n### F3\n";
    const target = "## FAQ\n### Q1\n";
    const result = validateFaqPreservation(source, target);
    expect(result.valid).toBe(false);
    expect(result.sourceCount).toBe(3);
    expect(result.targetCount).toBe(1);
    expect(result.delta).toBe(2);
    expect(result.message).toMatch(/lost 2/);
  });

  it("reports when target has more items (LLM hallucinated)", () => {
    const source = "## FAQ\n### Q1\n";
    const target = "## FAQ\n### Q1\n### Q2\n";
    const result = validateFaqPreservation(source, target);
    expect(result.valid).toBe(false);
    expect(result.delta).toBe(-1);
    expect(result.message).toMatch(/added 1/);
  });

  it("treats source-without-FAQ + target-without-FAQ as valid (both 0)", () => {
    const source = "# Article\n\nNo FAQ here.\n";
    const target = "# Article\n\nKein FAQ hier.\n";
    const result = validateFaqPreservation(source, target);
    expect(result.valid).toBe(true);
    expect(result.sourceCount).toBe(0);
    expect(result.targetCount).toBe(0);
  });

  it("reproduces Toolwiki chatgpt-ads-2026 case (DE 6 → EN 0)", () => {
    const sourceDe = [
      "## Häufige Fragen",
      "### Frage 1?",
      "A.",
      "### Frage 2?",
      "A.",
      "### Frage 3?",
      "A.",
      "### Frage 4?",
      "A.",
      "### Frage 5?",
      "A.",
      "### Frage 6?",
      "A.",
    ].join("\n");
    const targetEn = "# Article\n\nNo FAQ section was translated.\n";
    const result = validateFaqPreservation(sourceDe, targetEn);
    expect(result.valid).toBe(false);
    expect(result.sourceCount).toBe(6);
    expect(result.targetCount).toBe(0);
    expect(result.delta).toBe(6);
  });
});
