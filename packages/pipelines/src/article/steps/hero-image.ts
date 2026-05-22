import { generateImage as nanoBananaGenerate } from "@marketing-auto/adapter-nano-banana";
import { replicate } from "@marketing-auto/adapter-replicate";
import { COST_OPS, estimateHeroImageCost } from "@marketing-auto/core/cost";
import { type EstimatorContext } from "@marketing-auto/cost-tracker";
import {
  articles,
  db,
  type ImageBatchResponseBody,
  plannedItems,
} from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { enqueueImageBatch } from "../../engine/image-batch-client.ts";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { resolveImageConfig } from "../lib/image-config.ts";
import { buildPromptWithResolutionHint } from "../lib/prompt-resolution-hints.ts";
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
  // Spec 64.6c: R2 key of the pre-conversion original (PNG/JPEG/etc.). NULL when
  // input was already WebP, when the hero step was skipped, or when caller opted
  // out via discardOriginal. Persisted by PersistArticleStep via the bridge.
  originalR2Key: z.string().nullable().optional(),
});

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

/**
 * Spec 64.7: Shared alt-text builder used by both the sync path (below) and
 * the batch-resume path. Kept locale-aware — DE gets a clean "Beitragsbild"
 * suffix (the heroImagePrompt is English-only by Gemini contract, so mixing it
 * into a German alt-text would produce a screen-reader language mismatch).
 */
function buildHeroAltTextForResume(
  title: string,
  heroPrompt: string,
  locale: string | null | undefined,
): string {
  return locale === "de" ? `${title} – Beitragsbild` : `${title} — ${heroPrompt.slice(0, 100)}`;
}

export class HeroImageStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "hero-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  // Spec 64.7: Gemini Batch API offers a 50% discount on hero-image generation
  // when llmMode === "batch". The Planner's tier-1 step-sum applies the
  // BATCH_DISCOUNT_FACTOR to this step's estimate via the `llmBound` flag —
  // same mechanism used by Anthropic LLM batch steps (Spec 62.5.1). Without
  // the flag the displayed plan cost would over-estimate hero images in batch
  // mode by 2× the real Gemini bill.
  override readonly llmBound = true;

  override estimatedCostEur(_input: unknown, context?: EstimatorContext): number {
    // Spec 64.6b: when the planner passes provider + resolution via the
    // EstimatorContext (read from the frozen plan snapshot), use the project-
    // aware rate. Otherwise fall back to the legacy worst-case 1K upper bound.
    if (context?.imageProvider && context.imageResolution) {
      return estimateHeroImageCost(context.imageProvider, context.imageResolution);
    }
    // Upper-bound for callers without the snapshot context (e.g. ad-hoc runs):
    // Nano Banana 2 @ 1K ≈ €0.062, Flux 1.1 Pro ≈ €0.037. 0.07 keeps the
    // pre-snapshot legacy behaviour intact.
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

    // Spec 64.7 Pattern 118 (image variant): batch resume path. The image-batch
    // processor stamped JSON-encoded `ImageBatchResponseBody` into
    // `ctx.batchResult.content` via image-batch-resume.ts. Discriminate by
    // stepKey (same convention as the LLM batch resume) to avoid re-running
    // the upload + cost-tracker writes the worker already did.
    if (ctx.batchResult?.stepKey === this.name) {
      const parsed = JSON.parse(ctx.batchResult.content) as ImageBatchResponseBody;
      // Failure path: graceful skip — same shape sync mode uses on adapter error.
      // The article lands in final_review without a hero rather than failing.
      if (parsed.error !== undefined) {
        ctx.log.warn(
          { articleId: input.articleId, error: parsed.error },
          "HeroImageStep batch-resume: image batch failed — skipping with empty hero",
        );
        return { r2Key: "", publicUrl: "", altText: outline.title, skipped: true };
      }

      // Cost-log: the image-batch-processor worker writes the authoritative
      // `image_batch:result` actual-cost row when the Gemini batch result
      // arrives (cost is paid at billing-time, not at pipeline-resume time).
      // Do NOT duplicate-write here — the worker fires before re-enqueue.

      const altText = buildHeroAltTextForResume(outline.title, outline.heroImagePrompt, article.locale);
      ctx.log.info(
        {
          articleId: input.articleId,
          r2Key: parsed.r2Key,
          publicUrl: parsed.publicUrl,
          costEur: parsed.costEur,
        },
        "HeroImageStep batch-resume: hero image restored from batch result",
      );
      return {
        r2Key: parsed.r2Key,
        publicUrl: parsed.publicUrl,
        altText,
      };
    }

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

    const { provider, resolution } = await resolveImageConfig(input.projectId);
    const seed = seedFromArticleId(input.articleId);
    const storagePrefix = `${input.projectSlug}/articles/hero`;

    // Spec 64.6d: aspect-ratio + resolution are derived by Gemini from prompt text
    // (Discovery 64.8 §4). Augment ONCE here; all three downstream paths (batch
    // enqueue / sync nano-banana / sync replicate) receive the augmented prompt.
    // The alt-text builder still uses outline.heroImagePrompt (raw) — the Format
    // suffix is rendering noise, not human-readable alt content.
    const augmentedPrompt = buildPromptWithResolutionHint(outline.heroImagePrompt, resolution);

    // Spec 64.7 Pattern 118 (image variant): batch enqueue path. Only Nano-Banana
    // providers participate — Flux has no batch tier (cascade in sync mode).
    if (ctx.llmMode === "batch" && provider === "nano-banana-2") {
      // Resolve the plan id via planned_items.pipeline_run_id. The plan-coordinator
      // queries by weekly_plan_id; standalone runs (no plan) can't be coordinated
      // — those should pass overrideLlmMode='sync' at the trigger boundary
      // (Spec 64.7 §3.9). A NULL plan_id here is therefore a misconfiguration.
      if (!ctx.pipelineRunId) {
        ctx.log.warn(
          { articleId: input.articleId },
          "HeroImageStep batch: missing pipelineRunId in ctx — falling back to sync",
        );
      } else {
        const [planRow] = await db
          .select({ weeklyPlanId: plannedItems.weeklyPlanId })
          .from(plannedItems)
          .where(eq(plannedItems.pipelineRunId, ctx.pipelineRunId))
          .limit(1);
        const weeklyPlanId = planRow?.weeklyPlanId ?? null;
        if (weeklyPlanId === null) {
          ctx.log.warn(
            { articleId: input.articleId, pipelineRunId: ctx.pipelineRunId },
            "HeroImageStep batch: no planned_item linked to run — falling back to sync (standalone runs should use overrideLlmMode='sync')",
          );
        } else {
          ctx.log.info(
            { articleId: input.articleId, weeklyPlanId, provider, resolution, seed },
            "HeroImageStep: suspending — enqueuing image batch request",
          );
          const signal = await enqueueImageBatch({
            projectId: ctx.projectId,
            pipelineRunId: ctx.pipelineRunId,
            weeklyPlanId,
            articleId: input.articleId,
            prompt: augmentedPrompt,
            model: "nano-banana-2",
            resolution,
            aspectRatio: "16:9",
            seed,
            outputFormat: "webp",
            storagePrefix,
          });
          // Cast through unknown: Pattern 118 runner-side checks for the
          // `imageBatchPending: true` shape BEFORE outputSchema.parse(), so
          // returning the suspension signal is safe (won't trip schema validation).
          return signal as unknown as z.infer<typeof OutputSchema>;
        }
      }
    }

    // Use project-aware estimate for the per-call assertCostBudget pre-flight
    // (still capped by COST_ESTIMATES_EUR["google-gemini"][HERO_IMAGE] = 0.25 inside the adapter).
    const perCallEstimate = estimateHeroImageCost(provider, resolution);

    ctx.log.info(
      { articleId: input.articleId, provider, resolution, seed },
      "HeroImageStep: generating hero image"
    );

    let result: {
      r2Key: string;
      publicUrl: string;
      originalR2Key: string | null;
    } | null = null;
    try {
      if (provider === "nano-banana-2") {
        const out = await nanoBananaGenerate({
          projectId: ctx.projectId,
          ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
          articleId: input.articleId,
          operation: COST_OPS.HERO_IMAGE,
          model: "nano-banana-2",
          prompt: augmentedPrompt,
          aspectRatio: "16:9",
          resolution,
          outputFormat: "webp",
          outputQuality: 90,
          seed,
          storagePrefix,
          estimatedCostEur: perCallEstimate,
        });
        result = { r2Key: out.r2Key, publicUrl: out.publicUrl, originalR2Key: out.originalR2Key };
      } else {
        const out = await replicate.generateImage({
          projectId: ctx.projectId,
          ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
          articleId: input.articleId,
          operation: COST_OPS.HERO_IMAGE,
          model: "flux-1.1-pro",
          prompt: augmentedPrompt,
          aspectRatio: "16:9",
          outputFormat: "webp",
          storagePrefix,
          estimatedCostEur: perCallEstimate,
          seed,
        });
        result = { r2Key: out.r2Key, publicUrl: out.publicUrl, originalR2Key: out.originalR2Key };
      }
    } catch (err) {
      // Graceful skip: provider not configured or quota/transient error.
      // Draft + self-review are already done — do NOT fail the pipeline.
      // The article lands in final_review without a hero image; image can be added later.
      ctx.log.warn(
        { err, articleId: input.articleId, provider, resolution },
        "HeroImageStep: image generation failed — skipping, draft will still be persisted"
      );
      return { r2Key: "", publicUrl: "", altText: outline.title, skipped: true };
    }

    // Alt-text is locale-native. The heroImagePrompt is English (model requirement),
    // so DE articles use title-only to avoid mixing languages in screen-reader text.
    // Spec 64.7: same helper as the batch-resume path.
    const altText = buildHeroAltTextForResume(outline.title, outline.heroImagePrompt, article.locale);

    return {
      r2Key: result.r2Key,
      publicUrl: result.publicUrl,
      altText,
      // Spec 64.6c: bubble up the pre-conversion original R2 key (null when the
      // producer returned WebP natively).
      originalR2Key: result.originalR2Key,
    };
  }
}
