import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import {
  type AnalyzeLinksOutput,
  AnalyzeLinksOutputSchema,
  AnalyzeLinksOutputSchemaOutput,
} from "../types.ts";

const InputSchema = z.object({
  article: z.object({
    slug: z.string(),
    title: z.string(),
    cornerstoneKeyword: z.string(),
    bodyMd: z.string(),
    projectSlug: z.string(),
  }),
  candidates: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      cornerstoneKeyword: z.string(),
      metaDescription: z.string(),
    })
  ),
  existingLinkSlugs: z.array(z.string()),
});

export class AnalyzeLinksStep extends BaseStep<z.infer<typeof InputSchema>, AnalyzeLinksOutput> {
  readonly name = "analyze-links";
  readonly inputSchema = InputSchema;
  readonly outputSchema = AnalyzeLinksOutputSchemaOutput;

  override estimatedCostEur(): number {
    return 0.3;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<AnalyzeLinksOutput> {
    if (input.candidates.length === 0) {
      return { suggestions: [], overallNotes: "No candidates available (solo cluster article)" };
    }

    const existingNote =
      input.existingLinkSlugs.length > 0
        ? `These slugs are ALREADY linked: ${input.existingLinkSlugs.join(", ")}. Do NOT add duplicate links to them. You may suggest replacing existing anchor text only if you have a clearly better placement.`
        : "No existing internal links in this article.";

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "ai-seo", "content-strategy"],
      projectIdOrSlug: input.article.projectSlug,
      stepInstructions: `
You are choosing internal link placements for an article. Internal links pass topical
authority between related articles and help users navigate. Your job: pick 3-7 link
placements that read naturally.

Hard rules:

1. **Anchor text MUST be a verbatim substring of the source article's bodyMd.**
   Do NOT paraphrase or invent. Find a phrase that already exists in the article and use it.

2. **Anchor text should be a NOUN PHRASE related to the target's topic** — not generic
   ("click here", "this guide"). Good: "Claude API einrichten" linking to claude-api-setup.
   Bad: "diese Anleitung".

3. **No more than 1 link per H2 section** — internal links shouldn't cluster.

4. **No duplicate links to the same target slug** — if an article should be linked, link
   it once.

5. **Skip if it doesn't fit naturally.** Some articles have 0 sensible links to others.
   Returning fewer suggestions is better than forcing them in.

6. **Avoid linking from headings** — anchor text must be in body prose, not H1/H2/H3.

7. **Existing links in the article**: ${existingNote}

Output JSON matching:
{
  "suggestions": [
    {
      "targetSlug": "<slug from candidates>",
      "anchorText": "<verbatim substring from article body>",
      "sectionHint": "<the H2 heading text where this anchor appears>",
      "reasoning": "<1 sentence why this link makes sense>"
    },
    ...
  ],
  "overallNotes": "<2-3 sentence summary of your placement strategy>"
}

Constraint: max 10 suggestions. Aim for 3-7. Quality > quantity.
      `,
    });

    const candidatesList = input.candidates
      .map(
        (c) =>
          `- /${c.slug} — "${c.title}" (cornerstone: "${c.cornerstoneKeyword}"; ${c.metaDescription})`
      )
      .join("\n");

    const userMsg = [
      `# Source article (we're choosing links FOR this article)`,
      `Slug: ${input.article.slug}`,
      `Title: ${input.article.title}`,
      `Cornerstone keyword: ${input.article.cornerstoneKeyword}`,
      "",
      "# Body",
      input.article.bodyMd,
      "",
      "# Available link targets in this cluster",
      candidatesList,
      "",
      "Now produce link suggestions per the rules.",
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.INTERNAL_LINK_ANALYSIS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
      systemSuffix: resolvePrompt(ctx, this.name, () => prompt.variableSuffix),
      userMessage: userMsg,
      maxTokens: 3000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return AnalyzeLinksOutputSchema.parse(result.json);
  }
}
