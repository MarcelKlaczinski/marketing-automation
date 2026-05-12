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
  publicUrl: z.string(), // may be empty string when image generation is skipped
  altText: z.string(),
  skipped: z.boolean().optional(),
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
      .select({ outline: articles.outline, locale: articles.locale })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article?.outline) throw new ArticlePipelineError("Article missing outline", "image");

    const outline = ArticleOutlineSchema.parse(article.outline);

    let result: { r2Key: string; publicUrl: string } | null = null;
    try {
      result = await replicate.generateImage({
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
    } catch (err) {
      // Graceful skip: Replicate not configured or quota error.
      // Draft + self-review are already done — do NOT fail the pipeline.
      // The article lands in final_review without a hero image; image can be added later.
      ctx.log.warn(
        { err, articleId: input.articleId },
        "HeroImageStep: image generation failed — skipping, draft will still be persisted"
      );
      // Provide a minimal alt-text from the title so the article is not left
      // with a completely empty alt attribute if the image is added manually later.
      return { r2Key: "", publicUrl: "", altText: outline.title, skipped: true };
    }

    // Alt-text is locale-native. The heroImagePrompt is English (model requirement),
    // so DE articles use title-only to avoid mixing languages in screen-reader text.
    const altText = article.locale === "de"
      ? `${outline.title} – Beitragsbild`
      : `${outline.title} — ${outline.heroImagePrompt.slice(0, 100)}`;

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
    };
  }
}
