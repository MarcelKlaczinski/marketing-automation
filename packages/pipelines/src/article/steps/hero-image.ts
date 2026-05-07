import { replicate } from "@marketing-auto/adapter-replicate";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
});

const OutputSchema = z.object({
  r2Key: z.string(),
  publicUrl: z.string().url(),
  altText: z.string(),
});

export class HeroImageStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "hero-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.04;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article?.outline) throw new ArticlePipelineError("Article missing outline", "image");

    const outline = ArticleOutlineSchema.parse(article.outline);

    const result = await replicate.generateImage({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      articleId: input.articleId,
      operation: COST_OPS.HERO_IMAGE,
      model: "flux-1.1-pro",
      prompt: outline.heroImagePrompt,
      aspectRatio: "16:9",
      storagePrefix: `${input.projectSlug}/articles/hero`,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const altText = `${outline.title} — ${outline.heroImagePrompt.slice(0, 100)}`;

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
    };
  }
}
