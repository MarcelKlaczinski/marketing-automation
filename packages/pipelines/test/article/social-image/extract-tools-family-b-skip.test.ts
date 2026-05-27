/**
 * Spec 65.8 Day-5-followup #2 — `ExtractToolsStep` Pattern 102 gate for
 * Family-B narrative carousels.
 *
 * The pre-fix bug: ExtractToolsStep prompted Haiku to "extract tools from
 * article body", parsed the response with `z.array(...).min(1).max(10).parse(parsed.tools)`,
 * and crashed with `[{code:"invalid_type", expected:"array", received:"undefined",
 * path:[]}]` when the LLM omitted the `tools` field. Family-B narrative-content
 * articles (story-arc-clickbait / lifestyle-listicle / opinion-recommendation)
 * have a SHORT brief-text body — the LLM has nothing to extract — so the
 * step systematically failed on every Marcel-approve of a recurring brief.
 *
 * Fix: shouldRun() returns false when `input.templateKeyOverride` is a
 * Family-B key (story-arc-clickbait, lifestyle-listicle, opinion-recommendation).
 * skipOutput() returns a stub with `extractedTools: []` + empty cover/end
 * fields. Family-A consumers never reach the skip path (their shouldRun returns
 * true); Family-B downstream consumers (GenerateCaption → StageFamilyBImages →
 * RenderSlides) build their composition from `domain_extras.familyBImages`
 * + `format_config.toolToFeature`, never from `extractedTools`.
 *
 * No LLM mocks needed: shouldRun() is pure (no I/O); skipOutput() is pure.
 * The full execute() path is offline-untestable without mocking anthropic.
 */
import { describe, expect, it } from "bun:test";
import { ExtractToolsStep } from "../../../src/article/social-image/steps.ts";
import { makeMockCtx } from "../../fixtures/mock-ctx.ts";

const baseInput = {
  articleId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  projectSlug: "test-project",
  theme: "dark" as const,
  variant: "stunning" as const,
  locales: ["de-DE"],
  articleTitle: "Test article",
  articleSlug: "test-article",
  intentType: "use_case",
  bodyMd: "Short narrative body that has no tool list to extract.",
  articleUrl: "https://example.com/test",
  brandTokens: {},
};

describe("ExtractToolsStep — Family-B Pattern 102 gate (Spec 65.8 Day-5-followup #2)", () => {
  const step = new ExtractToolsStep();
  const ctx = makeMockCtx({ projectId: baseInput.projectId });

  describe("shouldRun()", () => {
    it("returns FALSE for Family-B story-arc-clickbait", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: "story-arc-clickbait",
      });
      expect(result).toBe(false);
    });

    it("returns FALSE for Family-B lifestyle-listicle", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: "lifestyle-listicle",
      });
      expect(result).toBe(false);
    });

    it("returns FALSE for Family-B opinion-recommendation", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: "opinion-recommendation",
      });
      expect(result).toBe(false);
    });

    it("returns TRUE for Family-A comparison-grid-3", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: "comparison-grid-3",
      });
      expect(result).toBe(true);
    });

    it("returns TRUE for Family-A comparison-grid-4", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: "comparison-grid-4",
      });
      expect(result).toBe(true);
    });

    it("returns TRUE when templateKeyOverride is null (legacy default → Family-A path)", async () => {
      const result = await step.shouldRun!(ctx, {
        ...baseInput,
        templateKeyOverride: null,
      });
      expect(result).toBe(true);
    });

    it("returns TRUE when templateKeyOverride is undefined (no bridge injection yet)", async () => {
      const result = await step.shouldRun!(ctx, baseInput);
      expect(result).toBe(true);
    });
  });

  describe("skipOutput()", () => {
    it("returns a Zod-valid Output with empty extractedTools + empty cover/end fields", () => {
      const output = step.skipOutput!({
        ...baseInput,
        templateKeyOverride: "story-arc-clickbait",
      });

      // Input pass-through preserved (downstream Family-B steps read these).
      expect(output.articleId).toBe(baseInput.articleId);
      expect(output.projectId).toBe(baseInput.projectId);
      expect(output.bodyMd).toBe(baseInput.bodyMd);
      expect(output.locales).toEqual(baseInput.locales);

      // Family-A fields are empty stubs.
      expect(output.extractedTools).toEqual([]);
      expect(output.coverEyebrow).toBe("");
      expect(output.coverHeadlineLead).toBe("");
      expect(output.coverHeadlineHighlight).toBe("");
      expect(output.endHeadline).toBe("");
      expect(output.endHeadlineHighlight).toBe("");

      // templateKeyOverride survives so the runner can validate the output
      // against ExtractToolsOutputSchema (which now allows the field).
      expect(output.templateKeyOverride).toBe("story-arc-clickbait");
    });

    it("output passes outputSchema validation (extractedTools min(0) widening)", () => {
      const rawOutput = step.skipOutput!({
        ...baseInput,
        templateKeyOverride: "lifestyle-listicle",
      });
      // This is what the runner does — parse skipOutput through the schema
      // before persisting. The min(1) → min(0) widening (Spec 65.8
      // Day-5-followup #2) is what makes this pass.
      const validated = step.outputSchema.parse(rawOutput);
      expect(validated.extractedTools).toEqual([]);
    });
  });
});
