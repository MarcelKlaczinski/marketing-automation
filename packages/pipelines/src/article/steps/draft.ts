import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  modelOverride: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
});

const OutputSchema = z.object({
  bodyMd: z.string().min(500),
  wordCount: z.number().int().min(500),
});

export class DraftStep extends BaseStep<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  readonly name = "draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.8;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article) throw new ArticlePipelineError(`Article ${input.articleId} not found`, "draft");
    if (!article.outline) throw new ArticlePipelineError("Article has no outline", "draft");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const model =
      (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ??
      "claude-sonnet-4-6";

    const draftInstructions = `
You are writing the FULL DRAFT of an article based on the approved outline.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Match the outline EXACTLY — same H2s, same key points per section, same order.
3. Hit estimated word counts within ±20%. Do not pad.
4. Weave satellite keywords naturally (1-3 mentions per article, total). NO stuffing.
5. Write in Markdown:
   - H2 for sections (## Section Name)
   - H3 sparingly within sections
   - Use lists when the content is genuinely list-shaped, not as decoration
   - Code blocks with language tag for any code
   - Bold/italic for genuine emphasis only
6. Open with the intro angle from the outline (not a generic "In this article we will..." intro)
7. End with a conclusion that has a clear takeaway, not a summary
8. Use concrete examples, specific numbers, real product names where applicable
9. NO em-dashes used as filler. NO "delve", "navigate", "leverage", "robust" unless context demands them.
10. NO internal links — do not invent anchor tags or placeholder links. Spec 24 handles linking.

Output: pure Markdown, ready to publish. No frontmatter, no JSON wrapping.
    `.trim();
    const promptBase = {
      skills: ["copywriting", "copy-editing", "ai-seo", "product-marketing-context"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: draftInstructions,
    };
    const prompt = await buildSystemPrompt(
      input.locale ? { ...promptBase, locale: input.locale } : promptBase
    );

    const userMsg = [
      "# Outline to write",
      `**Title**: ${outline.title}`,
      `**Meta description**: ${outline.metaDescription}`,
      "",
      "## Intro angle",
      outline.introAngle,
      "",
      "## Sections",
      outline.sections
        .map((s, i) =>
          [
            `### ${i + 1}. ${s.h2}`,
            `*Intent*: ${s.intent}`,
            `*Estimated words*: ${s.estimatedWords}`,
            "*Key points*:",
            ...s.keyPoints.map((p) => `- ${p}`),
            s.targetKeywords.length > 0
              ? `*Naturally include*: ${s.targetKeywords.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n"),
      "",
      "Now write the full article in Markdown.",
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_DRAFT,
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 8000,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const bodyMd = result.raw;
    const wordCount = bodyMd.trim().split(/\s+/).length;

    if (wordCount < 500) {
      throw new ArticlePipelineError(
        `Draft too short: ${wordCount} words. Outline estimated ${outline.estimatedTotalWords}.`,
        "draft"
      );
    }

    return { bodyMd, wordCount };
  }
}
