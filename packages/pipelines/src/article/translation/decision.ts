import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";

const DEFAULT_SYSTEM_PREFIX =
  "You are a content strategy assistant that classifies translation requirements.";

const InputSchema = z.object({
  articleId:        z.string().uuid(),
  projectId:        z.string().uuid(),
  sourceTitle:      z.string(),
  sourceBodyExcerpt: z.string(),   // first 2000 chars of source body
  primaryKeyword:   z.string(),
  intentType:       z.string().nullable(),
  briefSource:      z.string(),
  sourceLocale:     z.enum(["de", "en"]),
  targetLocale:     z.enum(["de", "en"]),
});

const OutputSchema = z.object({
  decision:  z.enum(["literal", "adaptive"]),
  reasoning: z.string(),
});

export type TranslationDecision = z.infer<typeof OutputSchema>;

const DE_TO_EN_ADAPTIVE_MARKERS = `
- German-specific pricing (EUR only, no USD reference)
- DSGVO/BaFin/Mittelstand emphasis
- "Made in Germany" framing
- DACH-only market data (Statista DE, Bitkom)
- German legal context (UWG, BDSG)
- German B2B sales norms (very formal, Sie-form heavy)
`.trim();

const EN_TO_DE_ADAPTIVE_MARKERS = `
- US-centric pricing (USD only, no EUR equivalent for SaaS)
- US-specific regulatory framing (HIPAA, SOC 2 emphasis without GDPR mention)
- "Silicon Valley" or US-startup-culture framing
- US market data (Gartner US, Forrester US-only)
- English idioms that don't translate (e.g. "move fast and break things")
- US legal context (CCPA, but not GDPR/DSGVO)
- US-only consumer contexts (assumes SSN, US ZIP code, US tax IDs)
- Imperial units without metric equivalents
`.trim();

/**
 * Haiku call to decide whether the translation should be:
 * - "literal": translate source body directly (preserving structure, cheaper)
 * - "adaptive": generate a new target-locale outline (when source content is too locale-specific)
 *
 * Works bidirectionally: DE→EN and EN→DE.
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
    const sourceLocaleName = input.sourceLocale === "de" ? "German" : "English";
    const targetLocaleName = input.targetLocale === "de" ? "German" : "English";
    const adaptiveMarkers = input.sourceLocale === "de" ? DE_TO_EN_ADAPTIVE_MARKERS : EN_TO_DE_ADAPTIVE_MARKERS;

    const prompt = `You are evaluating whether a ${sourceLocaleName} blog article needs a ${targetLocaleName}-audience-specific outline adaptation, or can be translated directly.

Source article title: ${input.sourceTitle}
Source article body (first 2000 chars):
${input.sourceBodyExcerpt}

Brief context:
- Primary keyword: ${input.primaryKeyword}
- Intent: ${input.intentType ?? "general"}
- Source: ${input.briefSource}

Evaluate whether the article should be:
- "literal": ${targetLocaleName} version preserves source outline; only language changes. Content is universally relevant with no source-locale-specific context that needs reframing.
- "adaptive": ${targetLocaleName} audience needs different angles.

Examples that justify "adaptive" for ${sourceLocaleName} → ${targetLocaleName}:
${adaptiveMarkers}

When in doubt, prefer "literal" — it's faster and cheaper, and the LLM translation handles minor contextual adjustments.

Respond in JSON only:
{
  "decision": "literal" | "adaptive",
  "reasoning": "brief explanation (max 80 words)"
}`;

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces systemPrefix.
    const systemPrefix = await resolvePrompt(ctx, this.name, () => DEFAULT_SYSTEM_PREFIX);

    let raw: unknown;
    try {
      const result = await anthropic.messages({
        projectId:        ctx.projectId,
        pipelineRunId:    ctx.pipelineRunId,
        articleId:        input.articleId,
        operation:        COST_OPS.TRANSLATION_DECISION,
        model:            "claude-haiku-4-5",
        systemPrefix,
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

    ctx.log.info(
      { decision: parsed.data.decision, reasoning: parsed.data.reasoning, sourceLocale: input.sourceLocale, targetLocale: input.targetLocale },
      "Translation decision made",
    );
    return parsed.data;
  }
}
