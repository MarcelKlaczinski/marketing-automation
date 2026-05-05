import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { SelfReviewIssueSchema } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  wordCount: z.number(),
  cornerstoneKeyword: z.string(),
  projectSlug: z.string(),
});

const OutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  issues: z.array(SelfReviewIssueSchema),
  shouldBlock: z.boolean(),
  summary: z.string(),
});

export class SelfReviewStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "self-review";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0.05; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["copy-editing", "product-marketing-context"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are reviewing a draft article for quality issues. You are STRICT.
You are NOT writing the article. You are critiquing it.

Categories to check:
- voice_drift: Does it sound like the project's voice (per marketing-context.md)?
- factual_concern: Any unsupported claims, made-up statistics, hallucinated product features?
- weak_intro: Does the opening hook the reader, or is it generic?
- weak_conclusion: Does the conclusion give a clear takeaway, or is it a summary?
- section_imbalance: Are sections wildly different lengths (e.g., one 800 words, one 100)?
- keyword_stuffing: Is the cornerstone keyword unnaturally repeated?
- missing_examples: Does the article make general claims without concrete examples?
- verbose: Are sentences padded with filler words ("in order to", "due to the fact that")?

Severity:
- critical: Must fix before publish (hallucination, severe voice drift, broken structure)
- warning: Should fix (weak intro, mild voice drift)
- suggestion: Could improve (better examples, tighter prose)

Score 0-100: 100 = ready to publish, 0 = unsalvageable rewrite.
Realistic scoring:
- 90+: only suggestions
- 70-89: a few warnings, no criticals
- 50-69: criticals exist, blocking
- <50: structural problems, suggest re-running with stricter outline

Output JSON: { "score": number, "issues": [...], "shouldBlock": boolean, "summary": string }
shouldBlock = true if ANY critical issues OR score < 70.
summary = 1-2 sentence overall verdict.
      `.trim(),
    });

    const userMsg = [
      `# Article under review`,
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Word count**: ${input.wordCount}`,
      ``,
      `---`,
      ``,
      input.bodyMd,
      ``,
      `---`,
      ``,
      `Now produce your review.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "article-self-review",
      model: "claude-haiku-4-5",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 3000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return OutputSchema.parse(result.json);
  }
}
