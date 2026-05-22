import { generateImage as nanoBananaGenerate } from "@marketing-auto/adapter-nano-banana";
import { replicate } from "@marketing-auto/adapter-replicate";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, projects } from "@marketing-auto/db";
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

type ImageProvider = "nano-banana-2" | "flux-1.1-pro";

/**
 * Spec 64.6: deterministic 31-bit non-negative seed from the article UUID.
 * Same articleId → same seed for every regeneration, enabling controlled A/B
 * comparisons (re-roll by passing seed+1 in a future UI). Collisions across
 * articles are harmless — at worst two articles land on the same Gemini-side
 * random state, which only matters for visual reproducibility.
 */
export function seedFromArticleId(articleId: string): number {
  let hash = 0;
  for (let i = 0; i < articleId.length; i++) {
    hash = (hash << 5) - hash + articleId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

async function resolveImageProvider(projectId: string): Promise<ImageProvider> {
  const [row] = await db
    .select({ provider: projects.imageGenerationProvider })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  // Defensive default — column default is "nano-banana-2" but if the projects
  // row was inserted before migration 0088 the column would be NULL.
  return (row?.provider ?? "nano-banana-2") as ImageProvider;
}

export class HeroImageStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "hero-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    // Upper-bound across providers: Nano Banana 2K ≈ €0.062, Flux 1.1 Pro ≈ €0.04.
    // Pre-flight cost gate uses this; real cost is logged after the call returns.
    return 0.07;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db
      .select({
        outline: articles.outline,
        locale: articles.locale,
        heroImageR2Key: articles.heroImageR2Key,
        heroImagePublicUrl: articles.heroImagePublicUrl,
      })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article?.outline) throw new ArticlePipelineError("Article missing outline", "image");

    const outline = ArticleOutlineSchema.parse(article.outline);

    // Skip if a hero image already exists (generated manually or propagated from DE sibling).
    // Generating a new one here would create a DE/EN mismatch every time draft runs.
    // Return existing publicUrl so PersistArticleStep doesn't overwrite it with "".
    if (article.heroImageR2Key) {
      ctx.log.info(
        { articleId: input.articleId, existingKey: article.heroImageR2Key },
        "HeroImageStep: hero already exists — skipping generation"
      );
      return {
        r2Key: article.heroImageR2Key,
        publicUrl: article.heroImagePublicUrl ?? "",
        altText: outline.title,
        skipped: true,
      };
    }

    const provider = await resolveImageProvider(input.projectId);
    const seed = seedFromArticleId(input.articleId);
    const storagePrefix = `${input.projectSlug}/articles/hero`;

    ctx.log.info(
      { articleId: input.articleId, provider, seed },
      "HeroImageStep: generating hero image"
    );

    let result: { r2Key: string; publicUrl: string } | null = null;
    try {
      if (provider === "nano-banana-2") {
        const out = await nanoBananaGenerate({
          projectId: ctx.projectId,
          ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
          articleId: input.articleId,
          operation: COST_OPS.HERO_IMAGE,
          model: "nano-banana-2",
          prompt: outline.heroImagePrompt,
          aspectRatio: "16:9",
          outputFormat: "webp",
          outputQuality: 90,
          seed,
          storagePrefix,
          estimatedCostEur: this.estimatedCostEur(),
        });
        result = { r2Key: out.r2Key, publicUrl: out.publicUrl };
      } else {
        result = await replicate.generateImage({
          projectId: ctx.projectId,
          ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
          articleId: input.articleId,
          operation: COST_OPS.HERO_IMAGE,
          model: "flux-1.1-pro",
          prompt: outline.heroImagePrompt,
          aspectRatio: "16:9",
          outputFormat: "webp",
          storagePrefix,
          estimatedCostEur: this.estimatedCostEur(),
          seed,
        });
      }
    } catch (err) {
      // Graceful skip: provider not configured or quota/transient error.
      // Draft + self-review are already done — do NOT fail the pipeline.
      // The article lands in final_review without a hero image; image can be added later.
      ctx.log.warn(
        { err, articleId: input.articleId, provider },
        "HeroImageStep: image generation failed — skipping, draft will still be persisted"
      );
      return { r2Key: "", publicUrl: "", altText: outline.title, skipped: true };
    }

    // Alt-text is locale-native. The heroImagePrompt is English (model requirement),
    // so DE articles use title-only to avoid mixing languages in screen-reader text.
    const altText =
      article.locale === "de"
        ? `${outline.title} – Beitragsbild`
        : `${outline.title} — ${outline.heroImagePrompt.slice(0, 100)}`;

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
    };
  }
}
