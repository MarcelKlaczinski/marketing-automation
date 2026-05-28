/**
 * Spec 65.16 — Nano Banana 2 orchestrator for Family-B image slides.
 *
 * Sibling to `photographic/orchestrator.ts` — exposes the same shape
 * (`getImagesForSlides`-compat: `entries: FamilyBImageEntry[]` + `failedSlideIndices`
 * + `stats`) but generates each slide's image via the NB2 adapter instead
 * of searching providers + vision-picking.
 *
 * Per-slide flow:
 *   1. cache lookup       — `findCachedEntryForSlide()` in articles.domain_extras
 *      (same R2-staged WebP cache as photographic; entries are interchangeable
 *      thanks to the `license.provider = "nano-banana-2"` enum widening in
 *      `packages/social/src/photographic/types.ts`)
 *   2. buildNB2Prompt     — preset-aware signature prompt with anti-AI-slop
 *   3. nanoBanana.generateImage — Gemini Image API call, decoded + R2-staged
 *      via the adapter's internal `convertImageToWebp` (Pattern 119)
 *   4. assemble FamilyBImageEntry with synthetic license (no photographer)
 *
 * Soft-fail per slide (same posture as photographic): any failure during
 * prompt-build / NB2 generation / R2 stage drops THAT slide from the result.
 * Caller falls back to gradient rendering for the missing slide.
 *
 * Cost-tracking: each NB2 call goes through the adapter's `track()` wrapper
 * which writes a `cost_logs` row with `service="google-gemini"` +
 * `operation="social-nb2-image"`. The per-call pre-flight gate uses
 * `COST_OPS.SOCIAL_NB2_IMAGE` (€0.25 upper bound). Real per-call cost is
 * ~€0.062 at the default 1k/standard model.
 *
 * Per-slide seed (per design-skill "vary aesthetics, never converge"):
 *   `seed = hash(articleId, slideIndex)` — deterministic per (article, slide)
 *   so re-renders without `refreshImages` produce the same image. Re-roll
 *   bumps the seed by slideIndex.
 */
import { generateImage } from "@marketing-auto/adapter-nano-banana";
import { COST_OPS } from "@marketing-auto/core/cost";
import {
  buildNB2Prompt,
  type PresetKey,
  type SlideRole,
} from "@marketing-auto/social/presets/catalog";
import {
  findCachedEntryForSlide,
  type FamilyBImageEntry,
} from "@marketing-auto/social/photographic";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("nb2:orchestrator");

/**
 * Per-slide context the NB2 orchestrator needs. Mirrors `ImageSlideRequest`
 * from the photographic orchestrator so callers can build one shape and
 * dispatch to either path.
 */
export interface NB2ImageSlideRequest {
  slideIndex: number;
  /** Composition role — drives the focal-point ask of the NB2 prompt. */
  slideRole: SlideRole;
  /** Narrative beat label (e.g. "conflict") — used in prompt prose. */
  narrativeBeat: string;
  /** LLM-generated beat-text (1-3 sentences) describing the slide content. */
  beatText: string;
  /** Rendered hook + variables for subject anchoring. */
  hookContext: {
    rendered: string;
    variables: Record<string, string>;
  };
}

export interface OrchestrateNB2ImagesInput {
  projectId: string;
  projectSlug: string;
  articleId: string;
  formatType: string;
  /** Preset that drives signature visual-language. */
  preset: PresetKey;
  /** Slides that need NB2 images. Gradient-only slides are not included. */
  slides: NB2ImageSlideRequest[];
  /** Existing cache entries from `articles.domain_extras.familyBImages[]`. */
  existingCache: ReadonlyArray<FamilyBImageEntry>;
  /** When true, ignore the cache and re-generate everything fresh. */
  refreshImages?: boolean;
  pipelineRunId?: string;
}

export interface OrchestrateNB2ImagesResult {
  /** New + cached entries, ordered by `slideIndex`. */
  entries: FamilyBImageEntry[];
  /** Indices of slides where NB2 failed to produce an image. */
  failedSlideIndices: number[];
  stats: {
    cacheHits: number;
    freshGenerations: number;
    failures: number;
  };
}

/**
 * 31-bit non-negative deterministic seed from `(articleId, slideIndex)`.
 * Mirrors the `seedFromArticleId` helper from `HeroImageStep` — same
 * `(h << 5) - h + charCode` accumulator. Same articleId + same slideIndex
 * always produces the same seed so re-renders without `refreshImages`
 * are deterministic.
 */
function seedForSlide(articleId: string, slideIndex: number): number {
  let hash = 0;
  const composite = `${articleId}:${slideIndex}`;
  for (let i = 0; i < composite.length; i++) {
    hash = (hash << 5) - hash + composite.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  // Force non-negative 31-bit so Gemini doesn't reject negative seeds.
  return Math.abs(hash) & 0x7fffffff;
}

/**
 * R2 prefix for NB2 social-image staging. Mirrors the photographic
 * pipeline's prefix shape (`<projectSlug>/social/<articleId>/<slideIndex>`)
 * so `cost_logs.metadata.r2Key` stays browsable per tenant + article.
 */
function buildStoragePrefix(projectSlug: string, articleId: string, slideIndex: number): string {
  return `${projectSlug}/social/${articleId}/slide-${slideIndex}`;
}

/**
 * Build a synthetic `FamilyBImageEntry.license` for an NB2-generated image.
 * No photographer (AI-generated), no required attribution. Uses a synthetic
 * `sourceUrl` pointing at the R2 public URL so the field stays non-null.
 */
function buildNB2License(publicUrl: string): FamilyBImageEntry["license"] {
  return {
    provider: "nano-banana-2",
    photographer: null,
    sourceUrl: publicUrl,
  };
}

async function generateOneSlide(
  slide: NB2ImageSlideRequest,
  input: OrchestrateNB2ImagesInput,
): Promise<FamilyBImageEntry> {
  const { prompt } = buildNB2Prompt({
    preset: input.preset,
    slideRole: slide.slideRole,
    narrativeBeat: slide.narrativeBeat,
    beatText: slide.beatText,
    hookContext: slide.hookContext,
  });

  const seed = seedForSlide(input.articleId, slide.slideIndex);
  const storagePrefix = buildStoragePrefix(
    input.projectSlug,
    input.articleId,
    slide.slideIndex,
  );

  const result = await generateImage({
    projectId: input.projectId,
    operation: COST_OPS.SOCIAL_NB2_IMAGE,
    estimatedCostEur: 0.25, // per-call upper bound (4K Pro worst case)
    model: "nano-banana-2",
    resolution: "1k",
    aspectRatio: "4:5", // audit-only on Gemini; prompt-text drives actual ratio
    outputFormat: "webp",
    prompt,
    seed,
    storagePrefix,
    ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    articleId: input.articleId,
  });

  return {
    slideIndex: slide.slideIndex,
    r2Key: result.r2Key,
    r2Url: result.publicUrl,
    originalR2Key: result.originalR2Key,
    license: buildNB2License(result.publicUrl),
    queryUsed: `nb2:${input.preset}:${slide.slideRole}`,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Main NB2 orchestrator. Iterates the requested slides sequentially —
 * parallel NB2 calls would race the Gemini per-project quota and produce
 * 429s on a single render. Cached slides return instantly.
 */
export async function generateNB2ImagesForSlides(
  input: OrchestrateNB2ImagesInput,
): Promise<OrchestrateNB2ImagesResult> {
  const entries: FamilyBImageEntry[] = [];
  const failedSlideIndices: number[] = [];
  let cacheHits = 0;
  let freshGenerations = 0;

  for (const slide of input.slides) {
    // Cache lookup first (unless refreshImages forces a fresh generation).
    if (!input.refreshImages) {
      const cached = findCachedEntryForSlide(input.existingCache, slide.slideIndex);
      if (cached) {
        entries.push(cached);
        cacheHits++;
        continue;
      }
    }

    try {
      const entry = await generateOneSlide(slide, input);
      entries.push(entry);
      freshGenerations++;
      log.info(
        {
          projectId: input.projectId,
          articleId: input.articleId,
          slideIndex: slide.slideIndex,
          preset: input.preset,
          slideRole: slide.slideRole,
          r2Key: entry.r2Key,
        },
        "nb2-orchestrator: generated slide",
      );
    } catch (err) {
      failedSlideIndices.push(slide.slideIndex);
      log.warn(
        {
          projectId: input.projectId,
          articleId: input.articleId,
          slideIndex: slide.slideIndex,
          preset: input.preset,
          err: err instanceof Error ? err.message : String(err),
        },
        "nb2-orchestrator: slide failed — falling back to gradient",
      );
    }
  }

  // Stable ordering by slideIndex for deterministic snapshots.
  entries.sort((a, b) => a.slideIndex - b.slideIndex);

  return {
    entries,
    failedSlideIndices,
    stats: {
      cacheHits,
      freshGenerations,
      failures: failedSlideIndices.length,
    },
  };
}
