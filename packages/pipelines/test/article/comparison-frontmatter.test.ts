import { describe, expect, it } from "bun:test";
import { validateComparisonExtras } from "../../src/article/frontmatter/comparison.ts";

describe("validateComparisonExtras (Spec 61.2)", () => {
  const baseValid = {
    toolSlugs: ["chatgpt", "claude"],
    winner: "tool-a" as const,
    verdict:
      "Both models are excellent generalists. ChatGPT edges out for coding workflows; Claude wins for long-context reasoning.",
    comparedAt: "2026-05-19",
    testMethodology: "Tested across 12 real coding tasks during May 2026.",
  };

  it("accepts a minimal valid comparison frontmatter", () => {
    const r = validateComparisonExtras(baseValid);
    expect(r.ok).toBe(true);
  });

  it("rejects toolSlugs of length 1", () => {
    const r = validateComparisonExtras({ ...baseValid, toolSlugs: ["only-one"] });
    expect(r.ok).toBe(false);
  });

  it("rejects toolSlugs of length 5", () => {
    const r = validateComparisonExtras({
      ...baseValid,
      toolSlugs: ["a", "b", "c", "d", "e"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects winner='depends' without useCaseVerdicts", () => {
    const r = validateComparisonExtras({ ...baseValid, winner: "depends" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("depends");
      expect(r.error).toContain("useCaseVerdict");
    }
  });

  it("accepts winner='depends' with useCaseVerdicts", () => {
    const r = validateComparisonExtras({
      ...baseValid,
      winner: "depends",
      useCaseVerdicts: [
        { useCase: "Coding tasks", winner: "chatgpt", reason: "Better autocomplete." },
        { useCase: "Long documents", winner: "claude", reason: "Larger context window." },
        { useCase: "Brainstorming", winner: "chatgpt", reason: "More creative variations." },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid winner literal", () => {
    const r = validateComparisonExtras({
      ...baseValid,
      // intentionally wrong — LLM picked the slug instead of the positional label
      winner: "chatgpt",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a verdict shorter than 20 chars", () => {
    const r = validateComparisonExtras({ ...baseValid, verdict: "short" });
    expect(r.ok).toBe(false);
  });
});
