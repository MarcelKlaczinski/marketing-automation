/**
 * Spec 65.8 — Photographic-pipeline orchestrator.
 *
 * Top-level entry that turns "this slide needs an image" into a
 * `FamilyBImageEntry` (R2-staged WebP + license metadata). Composes:
 *
 *   1. cache lookup        — `findCachedEntryForSlide()` in articles.domain_extras
 *   2. query-keywords      — Haiku, 3 query strings per slide
 *   3. parallel-search     — Pexels + Unsplash + Pixabay candidate pool
 *   4. vision-pick         — Sonnet vision picks the best candidate
 *   5. R2 stage-cache      — convertImageToWebp via Pattern 119
 *
 * Per spec §3.7 Option γ (Hybrid emotion-heavy slides only) NOT every slide
 * passes an `imageBeat`. The caller decides which slides need photographic
 * backgrounds — gradient-only slides skip this orchestrator entirely.
 *
 * Soft-fail per slide: if any step throws (LLM, provider, R2), that ONE
 * slide is omitted from the result. The caller falls back to gradient
 * rendering for the missing slide (graceful degradation, Risk §10).
 */
import type { PexelsCredentials } from "@marketing-auto/adapter-pexels";
import type { PixabayCredentials } from "@marketing-auto/adapter-pixabay";
import type { UnsplashCredentials } from "@marketing-auto/adapter-unsplash";
import {
  findCachedEntryForSlide,
  type FamilyBImageEntry,
  type ProviderSearchResult,
  searchAllProviders,
  stageProviderImage,
} from "@marketing-auto/social/photographic";
import { createLogger } from "@marketing-auto/shared";
import {
  generateImageQueryKeywords,
  type HookContextForQueries,
} from "./generate-query-keywords.ts";
import { pickBestImage } from "./pick-image-llm.ts";

const log = createLogger("photographic:orchestrator");

/**
 * Per-slide context the orchestrator needs to plan a single image. The
 * caller (a planned Family-B pipeline step in Day 5) builds these from the
 * narrative payload + hook + per-template slide-anatomy decision.
 */
export interface ImageSlideRequest {
  slideIndex: number;
  hookContext: HookContextForQueries;
  narrativeBeat: string;
  beatText: string;
}

export interface OrchestrateImagesInput {
  projectId: string;
  projectSlug: string;
  articleId: string;
  formatType: string;
  /** Active brand primary color for vision-pick brand-harmony scoring. */
  brandPrimaryColor: string;
  theme: "dark" | "light";
  /** Slides that need photographic backgrounds. Gradient-only slides are not included. */
  slides: ImageSlideRequest[];
  /** Existing cache entries from `articles.domain_extras.familyBImages[]`. */
  existingCache: ReadonlyArray<FamilyBImageEntry>;
  /** When true, ignore the cache and re-stage everything fresh (re-render `refreshImages` flag). */
  refreshImages?: boolean;
  /** Provider credentials. Null entries are skipped (Marcel may disable one provider). */
  credentials: {
    pexels: PexelsCredentials | null;
    unsplash: UnsplashCredentials | null;
    pixabay: PixabayCredentials | null;
  };
  pipelineRunId?: string;
}

export interface OrchestrateImagesResult {
  /** New + cached entries, ordered by `slideIndex`. */
  entries: FamilyBImageEntry[];
  /** Indices of slides where the orchestrator failed to produce an image. */
  failedSlideIndices: number[];
  /** Per-step counters for cost/observability dashboards. */
  stats: {
    cacheHits: number;
    freshStages: number;
    failures: number;
    totalProviderCandidates: number;
  };
}

async function orchestrateOneSlide(
  slide: ImageSlideRequest,
  input: OrchestrateImagesInput,
): Promise<{ entry: FamilyBImageEntry; candidateCount: number; queriesSource: "llm" | "fallback"; pickSource: "llm" | "fallback" }> {
  // Step 1: query-keywords via Haiku. Soft-fails to text-derived fallback.
  const qkResult = await generateImageQueryKeywords({
    hookContext: slide.hookContext,
    narrativeBeat: slide.narrativeBeat,
    beatText: slide.beatText,
    formatType: input.formatType,
    projectId: input.projectId,
    ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
  });

  // Step 2: parallel-search Pexels + Unsplash + Pixabay across the 3 queries.
  const candidates: ProviderSearchResult[] = await searchAllProviders(input.credentials, {
    queries: qkResult.queries,
    perQuery: 5,
  });

  if (candidates.length === 0) {
    throw new Error(
      `No provider candidates for slideIndex=${slide.slideIndex} (queries=${JSON.stringify(qkResult.queries)})`,
    );
  }

  // Step 3: vision-pick via Sonnet. Soft-fails to candidates[0].
  const pick = await pickBestImage({
    candidates,
    beatText: slide.beatText,
    hookRendered: slide.hookContext.rendered,
    theme: input.theme,
    brandPrimaryColor: input.brandPrimaryColor,
    projectId: input.projectId,
    ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
  });

  // Step 4: R2 stage-cache (Pattern 119 via convertImageToWebp).
  const queryUsed = qkResult.queries.find((q) => q.length > 0) ?? qkResult.queries[0] ?? "(no query)";
  const entry = await stageProviderImage({
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    articleId: input.articleId,
    slideIndex: slide.slideIndex,
    candidate: pick.picked,
    queryUsed,
    unsplashCreds: input.credentials.unsplash,
  });

  return {
    entry,
    candidateCount: candidates.length,
    queriesSource: qkResult.source,
    pickSource: pick.source,
  };
}

/**
 * Main orchestrator. Iterates the requested slides sequentially (per spec
 * §4 ~5-8s per LLM-vision pick — parallelising would saturate the Anthropic
 * rate limit on a single render). Cached slides return instantly.
 */
export async function getImagesForSlides(
  input: OrchestrateImagesInput,
): Promise<OrchestrateImagesResult> {
  const entries: FamilyBImageEntry[] = [];
  const failedSlideIndices: number[] = [];
  let cacheHits = 0;
  let freshStages = 0;
  let totalCandidates = 0;

  for (const slide of input.slides) {
    // Cache lookup first (unless refreshImages forces a fresh stage).
    if (!input.refreshImages) {
      const cached = findCachedEntryForSlide(input.existingCache, slide.slideIndex);
      if (cached) {
        entries.push(cached);
        cacheHits++;
        continue;
      }
    }

    try {
      const result = await orchestrateOneSlide(slide, input);
      entries.push(result.entry);
      freshStages++;
      totalCandidates += result.candidateCount;
      log.info(
        {
          projectId: input.projectId,
          articleId: input.articleId,
          slideIndex: slide.slideIndex,
          provider: result.entry.license.provider,
          candidateCount: result.candidateCount,
          queriesSource: result.queriesSource,
          pickSource: result.pickSource,
        },
        "photographic-orchestrator: staged slide",
      );
    } catch (err) {
      failedSlideIndices.push(slide.slideIndex);
      log.warn(
        {
          projectId: input.projectId,
          articleId: input.articleId,
          slideIndex: slide.slideIndex,
          err: err instanceof Error ? err.message : String(err),
        },
        "photographic-orchestrator: slide failed — falling back to gradient",
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
      freshStages,
      failures: failedSlideIndices.length,
      totalProviderCandidates: totalCandidates,
    },
  };
}
