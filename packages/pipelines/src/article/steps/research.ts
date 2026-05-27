import { anthropic } from "@marketing-auto/adapter-anthropic";
import { dataforseo } from "@marketing-auto/adapter-dataforseo";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { ResearchResultSchema } from "../types.ts";

const InputSchema = z.object({
  cornerstoneKeyword: z.string(),
  satelliteKeywords: z.array(z.string()),
  projectSlug: z.string(),
  locale: z.enum(["de", "en"]).optional(),
});

export class ResearchStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof ResearchResultSchema>
> {
  readonly name = "research";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ResearchResultSchema;

  override estimatedCostEur(): number {
    // Calibrated against Toolwiki 30d data (2026-05-27): SERP fetch
    // (`article-research-serp-*`) avg €0.0018; LLM synthesis
    // (`research-competitor-synthesis`) avg €0.043. Old 0.10 LLM portion was
    // ~2.3× the real cost. ×1.5 margin on the LLM side keeps room for
    // unusual SERP volumes / longer competitor lists.
    return 0.0018 + 0.065; // DataForSEO SERP depth=10 + Anthropic Sonnet synthesis
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const serp = await dataforseo.serp({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: `article-research-serp-${sanitize(input.cornerstoneKeyword)}`,
      keyword: input.cornerstoneKeyword,
      depth: 10,
      estimatedCostEur: 0.0018,
    });

    const stepInstructions = `
You are analyzing a Google SERP to identify what topics, angles, and patterns
the currently-ranking pages are covering for a target keyword.

Your output: a 200-500 word synthesis covering:
1. **Common patterns**: What 80%+ of top results cover
2. **Coverage gaps**: What's notably missing or only weakly covered
3. **Differentiation opportunities**: What angles could let us stand out
4. **Reader intent**: What is someone searching this actually trying to accomplish?

Use the People Also Ask questions and Related Searches as additional intent signals.

Be specific. "Most pages cover X" is good. "There are some patterns" is bad.
    `.trim();
    const promptBase = { skills: ["ai-seo", "content-strategy"], projectIdOrSlug: input.projectSlug, stepInstructions };
    const prompt = await buildSystemPrompt(
      input.locale ? { ...promptBase, locale: input.locale } : promptBase
    );

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);

    const userMsg = [
      `# Target keyword: ${input.cornerstoneKeyword}`,
      "",
      "## Top 10 organic results",
      serp.organicResults
        .map((r, i) => `${i + 1}. **${r.title}** — ${r.domain}\n   ${r.snippet}`)
        .join("\n\n"),
      "",
      serp.peopleAlsoAsk.length > 0
        ? `## People Also Ask\n${serp.peopleAlsoAsk.map((q) => `- ${q}`).join("\n")}`
        : "",
      serp.relatedSearches.length > 0
        ? `## Related Searches\n${serp.relatedSearches.map((q) => `- ${q}`).join("\n")}`
        : "",
      input.satelliteKeywords.length > 0
        ? `## Satellite keywords this article should also cover\n${input.satelliteKeywords.map((k) => `- ${k}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const synth = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_RESEARCH_SYNTHESIS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
      userMessage: userMsg,
      maxTokens: 2000,
      estimatedCostEur: 0.1,
    });

    return ResearchResultSchema.parse({
      serp: {
        keyword: serp.keyword,
        organicResults: serp.organicResults.map((r) => ({
          position: r.position,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          domain: r.domain,
        })),
        peopleAlsoAsk: serp.peopleAlsoAsk,
        relatedSearches: serp.relatedSearches,
        serpFeatures: serp.serpFeatures,
      },
      competitorSynthesis: synth.raw,
    });
  }
}

function sanitize(s: string): string {
  return s
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 50);
}
