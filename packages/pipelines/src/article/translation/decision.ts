import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const InputSchema = z.object({
  articleId:   z.string().uuid(),
  projectId:   z.string().uuid(),
  deTitle:     z.string(),
  deBodyExcerpt: z.string(),  // first 2000 chars of DE body
  primaryKeyword: z.string(),
  intentType:  z.string().nullable(),
  briefSource: z.string(),
});

const OutputSchema = z.object({
  decision:  z.enum(["literal", "adaptive"]),
  reasoning: z.string(),
});

export type TranslationDecision = z.infer<typeof OutputSchema>;

/**
 * Haiku call to decide whether the EN translation should be:
 * - "literal": translate DE body directly (preserving structure, ~cheaper)
 * - "adaptive": generate a new outline for the EN audience (when DE content is too Germany-specific)
 */
export class TranslationDecisionStep extends BaseStep<
  z.infer<typeof InputSchema>,
  TranslationDecision
> {
  readonly name = "translation-decision";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur() { return 0.005; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<TranslationDecision> {
    const prompt = `You are evaluating whether a German blog article needs an English-audience-specific outline adaptation or can be translated directly.

DE Article Title: ${input.deTitle}
DE Article Body (first 2000 chars):
${input.deBodyExcerpt}

Brief context:
- Primary keyword: ${input.primaryKeyword}
- Intent: ${input.intentType ?? "general"}
- Source: ${input.briefSource}

Evaluate whether the article should be:
- "literal": EN version preserves DE outline; only language changes. The content is universally relevant with no German-specific context that needs reframing.
- "adaptive": EN audience needs different angles. Examples: German-specific pricing (EUR only, no USD), DSGVO/BaFin/German regulatory emphasis, "Made in Germany" framing, Mittelstand-specific examples, German market data only, German tool alternatives.

When in doubt, prefer "literal" — it's faster and cheaper, and the LLM translation handles minor contextual adjustments.

Respond in JSON only:
{
  "decision": "literal" | "adaptive",
  "reasoning": "brief explanation (max 80 words)"
}`;

    let raw: unknown;
    try {
      const result = await anthropic.messages({
        projectId:        ctx.projectId,
        pipelineRunId:    ctx.pipelineRunId,
        articleId:        input.articleId,
        operation:        COST_OPS.TRANSLATION_DECISION,
        model:            "claude-haiku-4-5",
        systemPrefix:     "You are a content strategy assistant that classifies translation requirements.",
        systemSuffix:     "",
        userMessage:      prompt,
        maxTokens:        300,
        jsonMode:         true,
        estimatedCostEur: this.estimatedCostEur(),
      });
      raw = result.json;
    } catch (err) {
      // Default to literal on error — cheaper path, safer fallback
      ctx.log.warn({ err }, "TranslationDecisionStep: LLM call failed — defaulting to literal");
      return { decision: "literal", reasoning: "Fallback: LLM call failed" };
    }

    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) {
      ctx.log.warn({ errors: parsed.error.issues }, "TranslationDecisionStep: output schema mismatch — defaulting to literal");
      return { decision: "literal", reasoning: "Fallback: schema mismatch" };
    }

    ctx.log.info({ decision: parsed.data.decision, reasoning: parsed.data.reasoning }, "Translation decision made");
    return parsed.data;
  }
}
