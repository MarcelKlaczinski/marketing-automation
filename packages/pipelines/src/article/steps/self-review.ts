import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { resolveMasterPrompt } from "../../config/index.ts";
import { SelfReviewIssueSchema } from "../types.ts";

const SELF_REVIEW_STEP_DEFAULT_PROMPT = `
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

Output a single JSON object with EXACTLY this shape (no markdown, no preamble):
{
  "score": 82,
  "issues": [
    {
      "severity": "warning",
      "category": "weak_intro",
      "location": "intro",
      "description": "Opening is too generic and doesn't hook the reader immediately.",
      "suggestion": "Start with a concrete stat or a specific reader pain point."
    }
  ],
  "shouldBlock": false,
  "summary": "Solid draft with one weak section. Publishable after fixing the intro."
}

Rules:
- severity: one of "critical", "warning", "suggestion"
- category: one of "voice_drift", "factual_concern", "weak_intro", "weak_conclusion", "section_imbalance", "keyword_stuffing", "missing_examples", "verbose", "other"
- location: name of the H2 section, or "intro", or "conclusion"
- description: required — specific description of the problem
- suggestion: optional — what to do to fix it
- shouldBlock: true if ANY critical issue exists OR score < 70
- If no issues found, set issues to an empty array []
`.trim();

const InputSchema = z.object({
  bodyMd: z.string(),
  wordCount: z.number(),
  cornerstoneKeyword: z.string(),
  projectSlug: z.string(),
  // Spec 54.9.1: linked article ID — passed through to cost_logs for per-article cost queries
  articleId: z.string().uuid().optional(),
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

  override estimatedCostEur(): number {
    return 0.05;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const stepInstructions = await resolveMasterPrompt({
      projectId: ctx.projectId,
      promptKey: "article.self_review",
      fallback: SELF_REVIEW_STEP_DEFAULT_PROMPT,
    });
    const prompt = await buildSystemPrompt({
      skills: ["copy-editing", "product-marketing"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions,
    });

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = resolvePrompt(ctx, this.name, () => prompt.variableSuffix);

    const userMsg = [
      "# Article under review",
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Word count**: ${input.wordCount}`,
      "",
      "---",
      "",
      input.bodyMd,
      "",
      "---",
      "",
      "Now produce your review.",
    ].join("\n");

    let raw: unknown;
    try {
      const result = await anthropic.messages({
        projectId: ctx.projectId,
        pipelineRunId: ctx.pipelineRunId,
        ...(input.articleId !== undefined ? { articleId: input.articleId } : {}),
        operation: COST_OPS.ARTICLE_SELF_REVIEW,
        model: "claude-haiku-4-5",
        systemPrefix: prompt.cacheablePrefix,
        systemSuffix,
        userMessage: userMsg,
        maxTokens: 3000,
        jsonMode: true,
        estimatedCostEur: this.estimatedCostEur(),
      });
      raw = result.json;
    } catch (err) {
      // Graceful skip: non-JSON or API error — draft is already persisted by PersistBodyStep.
      // Return a neutral score so the pipeline reaches PersistArticleStep.
      ctx.log.warn({ err }, "SelfReviewStep: LLM call failed — returning neutral fallback score");
      return { score: 70, issues: [], shouldBlock: false, summary: "Self-review unavailable — manual review required." };
    }

    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) {
      ctx.log.warn({ errors: parsed.error.issues }, "SelfReviewStep: output schema mismatch — returning neutral fallback");
      return { score: 70, issues: [], shouldBlock: false, summary: "Self-review schema error — manual review required." };
    }
    return parsed.data;
  }
}
