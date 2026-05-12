/**
 * article:hero-generation pipeline
 *
 * Standalone hero-image generation triggered from the UI.
 * Accepts an optional promptOverride so the user can review/edit the
 * outline's heroImagePrompt before committing to the Replicate call.
 *
 * Steps:
 *   1. GenerateHeroImageStep — loads outline from DB, generates via Replicate,
 *      persists heroImageR2Key/heroImagePublicUrl/heroImageAltText
 *   2. GenerateImageVariantsStep — reads the base WebP from local disk and
 *      generates 11 size variants in WebP + AVIF (22 files total) using sharp.
 *      Only runs in local dev (R2 not configured). Renames the base file from
 *      the UUID name to <slug>.webp for readability.
 *
 * NOTE: Variant generation is LOCAL ONLY. When R2 is configured, step 2 is a
 * no-op (returns variantCount: 0). R2 upload of variants is not yet implemented.
 */
import { replicate } from "@marketing-auto/adapter-replicate";
import { LOCAL_UPLOADS_ROOT, isR2Configured } from "@marketing-auto/adapter-storage";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, projects } from "@marketing-auto/db";
import { and, eq, ne } from "drizzle-orm";
import { HERO_VARIANTS } from "@marketing-auto/shared/hero-variants";
import { createLogger } from "@marketing-auto/shared";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { Pipeline } from "../../engine/pipeline.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const log = createLogger("pipelines:hero-generation");

// ─── Step 1: GenerateHeroImageStep ───────────────────────────────────────────

const StepInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  articleSlug: z.string(),
  /** If provided, overrides outline.heroImagePrompt for this generation run. */
  promptOverride: z.string().optional(),
});

const StepOutputSchema = z.object({
  r2Key: z.string(),
  publicUrl: z.string(),
  altText: z.string(),
  promptUsed: z.string(),
  articleSlug: z.string(),
});

class GenerateHeroImageStep extends BaseStep<
  z.infer<typeof StepInputSchema>,
  z.infer<typeof StepOutputSchema>
> {
  readonly name = "generate-hero-image";
  readonly inputSchema = StepInputSchema;
  readonly outputSchema = StepOutputSchema;

  override estimatedCostEur(): number {
    return 0.04; // Flux 1.1 Pro @ ~$0.04/image
  }

  async execute(input: z.infer<typeof StepInputSchema>, ctx: StepContext) {
    const [article] = await db
      .select({ outline: articles.outline, locale: articles.locale })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article?.outline) throw new ArticlePipelineError("Article has no outline yet", "image");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const basePrompt = input.promptOverride?.trim() || outline.heroImagePrompt;
    const promptUsed = basePrompt.includes("centered")
      ? basePrompt
      : `${basePrompt}, subject centered, centered composition`;

    const [proj] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!proj) throw new ArticlePipelineError("Project not found", "image");

    const result = await replicate.generateImage({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      articleId: input.articleId,
      operation: COST_OPS.HERO_IMAGE,
      model: "flux-1.1-pro",
      prompt: promptUsed,
      aspectRatio: "16:9",
      storagePrefix: `${proj.slug}/articles/hero`,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const altText =
      article.locale === "de"
        ? `${outline.title} – Beitragsbild`
        : `${outline.title} — ${promptUsed.slice(0, 100)}`;

    // Persist UUID-based key — step 2 will rename to slug-based and update
    await db
      .update(articles)
      .set({
        heroImageR2Key: result.r2Key,
        heroImagePublicUrl: result.publicUrl,
        heroImageAltText: altText,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.articleId));

    log.info({ articleId: input.articleId, r2Key: result.r2Key }, "Hero image generated");

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
      promptUsed,
      articleSlug: input.articleSlug,
    };
  }
}

// ─── Step 2: GenerateImageVariantsStep ───────────────────────────────────────

const VariantsInputSchema = z.object({
  r2Key: z.string(),
  publicUrl: z.string(),
  altText: z.string(),
  promptUsed: z.string(),
  articleSlug: z.string(),
});

const VariantsOutputSchema = z.object({
  r2Key: z.string(),
  publicUrl: z.string(),
  altText: z.string(),
  promptUsed: z.string(),
  variantCount: z.number(),
  variantKeys: z.array(z.string()),
});

class GenerateImageVariantsStep extends BaseStep<
  z.infer<typeof VariantsInputSchema>,
  z.infer<typeof VariantsOutputSchema>
> {
  readonly name = "generate-image-variants";
  readonly inputSchema = VariantsInputSchema;
  readonly outputSchema = VariantsOutputSchema;

  override estimatedCostEur(): number {
    return 0; // local CPU, no external API
  }

  async execute(input: z.infer<typeof VariantsInputSchema>, _ctx: StepContext) {
    // Skip when R2 is configured — R2 upload of variants is not yet implemented.
    // TODO: add R2 upload loop when needed; the local path below becomes the staging area.
    if (await isR2Configured()) {
      log.warn(
        { r2Key: input.r2Key },
        "R2 configured — skipping local variant generation (not yet implemented for R2)"
      );
      return {
        r2Key: input.r2Key,
        publicUrl: input.publicUrl,
        altText: input.altText,
        promptUsed: input.promptUsed,
        variantCount: 0,
        variantKeys: [],
      };
    }

    // r2Key: "<project>/articles/hero/<uuid>.webp"
    const keyParts = input.r2Key.split("/");
    const uuidFilename = keyParts.at(-1)!;
    const prefix = keyParts.slice(0, -1).join("/"); // "<project>/articles/hero"

    const uploadsRoot = LOCAL_UPLOADS_ROOT;
    const srcPath = join(uploadsRoot, ...keyParts);

    if (!existsSync(srcPath)) {
      log.warn({ srcPath }, "Source hero image not found locally — skipping variant generation");
      return {
        r2Key: input.r2Key,
        publicUrl: input.publicUrl,
        altText: input.altText,
        promptUsed: input.promptUsed,
        variantCount: 0,
        variantKeys: [],
      };
    }

    // Rename base file: <uuid>.webp → <slug>.webp (keep uuid file as backup)
    const slugFilename = `${input.articleSlug}.webp`;
    const slugPath = join(uploadsRoot, prefix, slugFilename);
    const baseBuffer = await Bun.file(srcPath).arrayBuffer();
    await Bun.write(slugPath, baseBuffer);
    log.debug({ slugPath }, "Base hero renamed to slug-based filename");

    const slugR2Key = `${prefix}/${slugFilename}`;
    const slugPublicUrl = input.publicUrl.replace(uuidFilename, slugFilename);

    // Lazy-load sharp to avoid import overhead in non-local paths.
    // `await import("sharp")` returns an ESM namespace object — the callable is at `.default`,
    // NOT the namespace itself. Calling the namespace directly throws TypeError and gets
    // swallowed by the per-variant catch, silently producing variantCount=0.
    type SharpCallable = (input: string) => import("sharp").Sharp;
    let sharpFn: SharpCallable | undefined;
    try {
      const mod = await import("sharp");
      sharpFn = (mod as unknown as { default: SharpCallable }).default ?? (mod as unknown as SharpCallable);
    } catch {
      log.warn("sharp not available — skipping variant generation");
      return {
        r2Key: slugR2Key,
        publicUrl: slugPublicUrl,
        altText: input.altText,
        promptUsed: input.promptUsed,
        variantCount: 0,
        variantKeys: [],
      };
    }

    const variantDir = join(uploadsRoot, prefix);
    await mkdir(variantDir, { recursive: true });

    const generatedKeys: string[] = [];
    const srcStat = await Bun.file(srcPath).stat();

    for (const variant of HERO_VARIANTS) {
      for (const fmt of ["webp", "avif"] as const) {
        const varFilename = `${input.articleSlug}${variant.suffix}.${fmt}`;
        const destPath = join(variantDir, varFilename);

        // Idempotent: skip if dest exists and is newer than source
        if (existsSync(destPath)) {
          const dstStat = await Bun.file(destPath).stat();
          if (dstStat && srcStat && dstStat.mtime.getTime() >= srcStat.mtime.getTime()) {
            generatedKeys.push(`${prefix}/${varFilename}`);
            continue;
          }
        }

        try {
          const pipeline = sharpFn(srcPath).resize(variant.width, variant.height, {
            fit: "cover",
            position: "center",
          });
          if (fmt === "webp") {
            await pipeline.webp({ quality: 82 }).toFile(destPath);
          } else {
            await pipeline.avif({ quality: 60, effort: 4 }).toFile(destPath);
          }
          generatedKeys.push(`${prefix}/${varFilename}`);
        } catch (err) {
          log.warn({ varFilename, err }, "Failed to generate variant — skipping");
        }
      }
    }

    log.info(
      { articleSlug: input.articleSlug, variantCount: generatedKeys.length },
      "Hero image variants generated"
    );

    return {
      r2Key: slugR2Key,
      publicUrl: slugPublicUrl,
      altText: input.altText,
      promptUsed: input.promptUsed,
      variantCount: generatedKeys.length,
      variantKeys: generatedKeys,
    };
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  articleSlug: z.string(),
  promptOverride: z.string().optional(),
}) as z.ZodType<PipelineInput>;

type PipelineInput = {
  articleId: string;
  projectId: string;
  articleSlug: string;
  promptOverride?: string;
};

export class HeroImageGenerationPipeline extends Pipeline<
  PipelineInput,
  z.infer<typeof VariantsOutputSchema>
> {
  readonly name = "article:hero-generation";
  readonly inputSchema = InputSchema;
  readonly outputSchema = VariantsOutputSchema;

  readonly steps = [
    new GenerateHeroImageStep(),
    new GenerateImageVariantsStep(),
  ] as const;

  /** Pass the step-1 output + pipeline-level slug into step-2. */
  override bridge(
    fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    output: unknown,
    _pipelineInput: PipelineInput
  ): unknown {
    if (
      fromStep.name === "generate-hero-image" &&
      toStep.name === "generate-image-variants"
    ) {
      // output already contains articleSlug (added in step 1's return)
      return output;
    }
    return output;
  }

  /** After both steps succeed, update DB with the slug-based r2Key and publicUrl. */
  override async afterComplete(
    output: z.infer<typeof VariantsOutputSchema>,
    input: PipelineInput
  ): Promise<void> {
    try {
      await db
        .update(articles)
        .set({
          heroImageR2Key: output.r2Key,
          heroImagePublicUrl: output.publicUrl,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, input.articleId));
      log.info(
        { articleId: input.articleId, r2Key: output.r2Key, variantCount: output.variantCount },
        "Hero image r2Key updated to slug-based name"
      );
    } catch (e) {
      log.warn({ articleId: input.articleId, err: e }, "Failed to update slug-based r2Key in afterComplete");
    }

    // Propagate hero to the translation sibling (if one exists and doesn't already have
    // its own separately-generated hero). "Own hero" = sibling's R2 key ends with the
    // sibling's slug, not the current article's slug.
    try {
      const [article] = await db
        .select({ translationKey: articles.translationKey, slug: articles.slug })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article?.translationKey) return;

      const [sibling] = await db
        .select({ id: articles.id, slug: articles.slug, heroImageR2Key: articles.heroImageR2Key })
        .from(articles)
        .where(
          and(
            eq(articles.translationKey, article.translationKey),
            ne(articles.id, input.articleId),
            eq(articles.projectId, input.projectId)
          )
        )
        .limit(1);

      if (!sibling) return;

      // Skip propagation if the sibling already has its own separately-generated hero
      // (identified by its R2 key ending with the sibling's own slug).
      const siblingKeyFilename = sibling.heroImageR2Key?.split("/").at(-1)?.replace(/\.[^.]+$/, "");
      if (siblingKeyFilename === sibling.slug) {
        log.info({ siblingId: sibling.id }, "Sibling has own hero — skipping propagation");
        return;
      }

      await db
        .update(articles)
        .set({
          heroImageR2Key: output.r2Key,
          heroImagePublicUrl: output.publicUrl,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, sibling.id));

      log.info({ siblingId: sibling.id, r2Key: output.r2Key }, "Hero propagated to translation sibling");
    } catch (e) {
      log.warn({ articleId: input.articleId, err: e }, "Failed to propagate hero to sibling — non-fatal");
    }
  }
}
