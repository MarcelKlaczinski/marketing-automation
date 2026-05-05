import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ArticleOutlineSchema, ArticleOutlineSchemaOutput, type ArticleOutline, type ResearchResult } from "../types.ts";

const InputSchema = z.object({
  cornerstoneKeyword: z.string(),
  satelliteKeywords: z.array(z.string()),
  clusterName: z.string(),
  clusterPillar: z.string(),
  projectSlug: z.string(),
  research: z.unknown(),
  modelOverride: z.string().optional(),
});

export class OutlineStep extends BaseStep<
  z.infer<typeof InputSchema>,
  ArticleOutline
> {
  readonly name = "outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ArticleOutlineSchemaOutput;

  override estimatedCostEur(): number { return 0.30; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const research = input.research as ResearchResult;
    const model = (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ?? "claude-opus-4-7";

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy", "ai-seo", "schema-markup"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are producing the OUTLINE for an article. Marcel will review this outline
before any draft is written. The outline must be specific enough that:
- A different writer could pick it up and produce a draft that matches the intent
- Marcel can spot strategic mistakes (wrong angle, wrong sections) in 2 minutes of reading
- The draft step has all the structural decisions made

Rules:
1. **Title**: Specific, intent-matching, ~60 chars (fits in SERP). Include the cornerstone
   keyword naturally. NO clickbait, NO ALL-CAPS, NO "[YEAR]" placeholders.
2. **Slug**: kebab-case, lowercase, max 60 chars, German-friendly (umlauts → ae/oe/ue/ss).
3. **Meta description**: 150-160 chars, includes cornerstone keyword, action-oriented.
4. **Intro angle**: 100-200 words explaining HOW we open this article.
   What's the hook? What stake does the reader have?
5. **Sections** (4-12 H2s, ordered for narrative flow):
   - Each H2 is specific (not "Introduction", "Conclusion" — those are the surrounding intro/outro)
   - Each section lists 2-10 key points the draft must hit
   - Each section has an estimated word count summing to 800-3500 total
   - Sections naturally weave in satellite keywords where relevant
6. **Hero image**: A specific prompt for Flux 1.1 Pro. NOT generic ("a person at a desk").
   Specific composition + style + mood. Include style enum.
7. **Estimated total words**: Realistic; do not pad.

You have access to:
- The marketing-context.md (voice, audience, pillars)
- Competitor synthesis (what the SERP covers — you should DIFFER strategically)
- Cluster context (this article is part of "${input.clusterName}", pillar "${input.clusterPillar}")
- Satellite keywords (must appear naturally; do not stuff)

Output JSON matching the ArticleOutlineSchema schema EXACTLY.
      `.trim(),
    });

    const userMsg = [
      `# Article brief`,
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Cluster**: ${input.clusterName} (pillar: ${input.clusterPillar})`,
      `**Satellite keywords to weave in**: ${input.satelliteKeywords.join(", ")}`,
      ``,
      `# SERP analysis`,
      research.competitorSynthesis,
      ``,
      `# Top organic competitors (for reference)`,
      research.serp.organicResults.slice(0, 5).map((r) =>
        `- ${r.title} (${r.domain})`
      ).join("\n"),
      ``,
      `# People Also Ask (use these to inform reader intent)`,
      research.serp.peopleAlsoAsk.slice(0, 8).map((q) => `- ${q}`).join("\n") || "(none)",
      ``,
      `Now produce the outline.`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "article-outline",
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return ArticleOutlineSchema.parse(result.json);
  }
}
