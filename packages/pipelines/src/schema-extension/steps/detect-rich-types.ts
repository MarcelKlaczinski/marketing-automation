import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { DetectionResultSchema } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  title: z.string(),
  projectSlug: z.string(),
});

export class DetectRichTypesStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof DetectionResultSchema>
> {
  readonly name = "detect-rich-types";
  readonly inputSchema = InputSchema;
  // ZodType cast — DetectionResultSchema has .default([]) on arrays (Spec 21 lesson #6)
  readonly outputSchema = DetectionResultSchema as z.ZodType<z.infer<typeof DetectionResultSchema>>;

  override estimatedCostEur(): number {
    return 0.05;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const prompt = await buildSystemPrompt({
      skills: ["schema", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are analyzing an article to determine which Schema.org rich-result types it qualifies for.

Two types to evaluate:

1. **FAQPage**: Article qualifies if it has a clear Q&A section with at least 3 distinct
   questions. Each question must:
   - Be phrased as a question (or as a heading clearly answering an implicit question)
   - Have a complete, self-contained answer below it
   - Cover something the reader might genuinely search for
   Common section names: "FAQ", "Häufige Fragen", "Antworten auf...", explicit H2/H3
   questions like "Wie installiere ich X?" with answer paragraphs.

2. **HowTo**: Article qualifies if it describes a SEQUENTIAL, ACTIONABLE procedure
   that achieves a specific outcome. Must have:
   - A clear goal (the "name" of the howto)
   - Numbered or clearly ordered steps (3+)
   - Imperative or actionable language ("Click X", "Run command Y", "Klicken Sie auf...")
   - NOT just a list of considerations or alternatives
   - NOT a comparison ranking ("Top 5 X")
   - NOT historical chronology

Output STRICT JSON matching:
{
  "hasFaq": boolean,
  "hasHowTo": boolean,
  "faqQuestions": [{ "question": string, "answer": string }, ...],
  "howToSteps": [{ "name": string, "text": string }, ...],
  "howToName": string | null,
  "howToTotalTime": string | null
}

Rules:
- If hasFaq is false, faqQuestions MUST be []
- If hasHowTo is false, howToSteps MUST be [], howToName MUST be null, howToTotalTime MUST be null
- Question text: 5-300 chars, use the original wording from the article when possible
- Answer text: 10-2000 chars, condensed prose (markdown stripped). For long answers, summarize
  the key answer in 2-3 sentences — do NOT include the full article body.
- howToSteps "name": short imperative (e.g. "Install dependencies"), max 200 chars
- howToSteps "text": detailed instruction, 10-1000 chars
- Be CONSERVATIVE. False positives hurt: a non-FAQ article wrongly tagged as FAQ gets
  rejected by Google's Rich Results Test. Better to return false than guess.
      `,
    });

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SCHEMA_RICH_DETECTION,
      model: "claude-haiku-4-5",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
      userMessage: [
        "# Article title",
        input.title,
        "",
        "# Article body",
        input.bodyMd,
        "",
        "Detect rich-result types per the rules above.",
      ].join("\n"),
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return DetectionResultSchema.parse(result.json);
  }
}
