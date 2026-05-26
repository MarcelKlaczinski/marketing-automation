/**
 * Spec 65.8 — Public surface of the photographic subsystem.
 *
 * Consumed by `packages/social/src/compositions/_shared/family-b/` at render
 * time and by `packages/pipelines/src/article/social-image/` orchestration
 * steps that schedule the LLM picks before each render.
 *
 * Day 1 surface (this commit) covers providers + license-tracker + R2 cache.
 * Day 2 adds `generateImageQueryKeywords` (Haiku) + `pickBestImage` (Sonnet
 * vision) + a top-level `getImagesForSlides` orchestrator.
 */
export {
  PHOTOGRAPHIC_PROVIDERS,
  familyBImageEntrySchema,
  familyBImagesArraySchema,
  licenseSchema,
  type FamilyBImageEntry,
  type License,
  type PhotographicProvider,
  type ProviderSearchResult,
} from "./types.ts";

export {
  searchAllProviders,
  searchPexelsAsProvider,
  searchPixabayAsProvider,
  searchUnsplashAsProvider,
  type ParallelSearchCredentials,
  type ParallelSearchInput,
} from "./providers/index.ts";

export {
  buildCaptionAttribution,
  licenseFromProvider,
  requiresAttribution,
} from "./license-tracker.ts";

export {
  findCachedEntryForSlide,
  stageProviderImage,
  type StageProviderImageInput,
} from "./r2-image-cache.ts";
