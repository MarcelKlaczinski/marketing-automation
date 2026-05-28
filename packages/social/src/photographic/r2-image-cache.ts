/**
 * Spec 65.8 — R2 stage-cache for photographic backgrounds.
 *
 * Pattern 119: ALL image storage to R2 goes through `convertImageToWebp` from
 * `@marketing-auto/adapter-image-webp`. Provider-supplied JPEGs are converted
 * to WebP for consistent CDN behaviour; the pre-conversion original lands at
 * `<prefix>/originals/<uuid>.<ext>` for forensic fallback.
 *
 * Cache key strategy: rather than asking the WebP adapter for a deterministic
 * R2 key (it always generates a UUID), we let it pick a UUID and remember the
 * resulting key in `articles.domain_extras.familyBImages[]` (a jsonb array
 * indexed by `slideIndex`). Re-renders look up the array first; cache-miss
 * triggers a fresh provider search + LLM-pick + stage.
 *
 * `triggerUnsplashDownload` is fired best-effort when the staged image came
 * from Unsplash — per their API guidelines, calling the download endpoint
 * upon actual use is the right thing to do.
 */
import {
  convertImageToWebp,
  type ConvertImageToWebpResult,
  ImageWebpError,
} from "@marketing-auto/adapter-image-webp";
import {
  triggerUnsplashDownload,
  type UnsplashCredentials,
} from "@marketing-auto/adapter-unsplash";
import { createLogger } from "@marketing-auto/shared";
import { licenseFromProvider } from "./license-tracker.ts";
import type { FamilyBImageEntry, ProviderSearchResult } from "./types.ts";

const log = createLogger("photographic:r2-image-cache");

export interface StageProviderImageInput {
  projectId: string;
  /** Used to construct the R2 prefix `<projectSlug>/articles/<articleId>/images`. */
  projectSlug: string;
  articleId: string;
  slideIndex: number;
  /** The LLM-picked candidate. */
  candidate: ProviderSearchResult;
  /** Query that produced this candidate — recorded on the cache entry for debugging. */
  queryUsed: string;
  /**
   * Unsplash credentials — required only when `candidate.provider === "unsplash"`
   * so we can fire the download-tracking ping. Pass null for the other paths.
   */
  unsplashCreds: UnsplashCredentials | null;
}

/**
 * Fetch the candidate image bytes, convert to WebP via the
 * `image-webp` adapter, return a `FamilyBImageEntry` ready to merge into
 * `articles.domain_extras.familyBImages[]`.
 *
 * Throws `ImageWebpError` (or a wrapping `Error`) on conversion / network
 * failure — caller should catch and fall back to gradient slide per spec
 * §3.7 Option γ / Risk §10 graceful-degradation.
 */
export async function stageProviderImage(
  input: StageProviderImageInput,
): Promise<FamilyBImageEntry> {
  const { candidate } = input;

  // 1. Fetch source bytes from provider CDN. Raw `fetch()` is acceptable here
  //    (despite the "always use typed adapter clients" rule) because the URL
  //    came from a Zod-validated provider response — we're not hitting an API,
  //    we're downloading bytes from a CDN URL the API just handed us. Same
  //    posture as `import-tool-brand-asset.ts:123` (brand-asset upload) and
  //    `convert-existing-heroes.ts` (R2 forensic round-trip).
  const res = await fetch(candidate.imageUrl);
  if (!res.ok) {
    throw new Error(
      `Provider image fetch failed: HTTP ${res.status} for ${candidate.imageUrl}`,
    );
  }
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const contentTypeHint = res.headers.get("Content-Type") ?? "application/octet-stream";

  // 2. Convert + upload via the WebP adapter (Pattern 119).
  const storagePrefix = `${input.projectSlug}/articles/${input.articleId}/images`;
  let converted: ConvertImageToWebpResult;
  try {
    converted = await convertImageToWebp({
      projectId: input.projectId,
      bytes,
      contentType: contentTypeHint,
      storagePrefix,
      // Quality default 85 — fine for photographic backgrounds at 40% opacity
      // (per spec §3.11 Option β + δ they're heavily overlaid anyway).
      //
      // Spec 65.16 V1.6-followup — downscale to 1620w (1.5× canvas for
      // retina-safety). Providers now hand us full-res originals (Pexels
      // `src.original` is 4000-6000px+) so without this resize R2 storage
      // would balloon. Sharp's `withoutEnlargement: true` makes smaller
      // inputs pass through unchanged (no upscale).
      maxWidth: 1620,
    });
  } catch (err) {
    if (err instanceof ImageWebpError) {
      log.warn(
        { articleId: input.articleId, slideIndex: input.slideIndex, provider: candidate.provider },
        `image-webp conversion failed: ${err.message}`,
      );
    }
    throw err;
  }

  // 3. Unsplash-only: ping the download-tracking endpoint per their TOS.
  //    Fire-and-forget; the helper swallows errors internally.
  if (
    candidate.provider === "unsplash" &&
    candidate.unsplashDownloadLocationUrl &&
    input.unsplashCreds
  ) {
    await triggerUnsplashDownload(input.unsplashCreds, candidate.unsplashDownloadLocationUrl);
  }

  // 4. Build the cache entry.
  return {
    slideIndex: input.slideIndex,
    r2Key: converted.webpKey,
    r2Url: converted.webpUrl,
    originalR2Key: converted.originalKey,
    license: licenseFromProvider({
      provider: candidate.provider,
      photographer: candidate.photographer,
      sourceUrl: candidate.sourceUrl,
    }),
    queryUsed: input.queryUsed,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Pure helper — find a cached entry by slideIndex.
 *
 * Callers persist + read `articles.domain_extras.familyBImages[]` themselves
 * (DB writes live in apps/api / packages/pipelines, not in social). This
 * helper exists so test fixtures + planning logic can share the lookup shape
 * without re-implementing it.
 */
export function findCachedEntryForSlide(
  entries: ReadonlyArray<FamilyBImageEntry>,
  slideIndex: number,
): FamilyBImageEntry | undefined {
  return entries.find((e) => e.slideIndex === slideIndex);
}
