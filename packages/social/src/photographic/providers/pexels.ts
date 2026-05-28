/**
 * Spec 65.8 — Pexels provider adapter for the photographic subsystem.
 *
 * Wraps `@marketing-auto/adapter-pexels` and maps the raw response onto
 * the cross-provider `ProviderSearchResult` shape.
 */
import { searchPexelsPhotos, type PexelsCredentials } from "@marketing-auto/adapter-pexels";
import type { ProviderSearchResult } from "../types.ts";

export async function searchPexelsAsProvider(
  creds: PexelsCredentials,
  queries: string[],
  perQuery = 5,
): Promise<ProviderSearchResult[]> {
  const allResults = await Promise.allSettled(
    queries.map((q) =>
      searchPexelsPhotos(creds, {
        query: q,
        perPage: perQuery,
        orientation: "portrait",
      }),
    ),
  );
  const out: ProviderSearchResult[] = [];
  for (const r of allResults) {
    if (r.status !== "fulfilled") continue;
    for (const photo of r.value) {
      out.push({
        provider: "pexels",
        // Spec 65.16 V1.6-followup — use `src.original` (full resolution,
        // often 4000×6000+) so the 1080×1350 (4:5) carousel renders without
        // any upscaling. `convertImageToWebp` (Pattern 119) downscales to
        // `maxWidth: 1620` (1.5× canvas for retina-safety) before encoding,
        // so R2 storage stays compact (~80-200KB per WebP).
        //
        // Why not `src.large` / `src.large2x`? Pexels' size variants are
        // height-capped: `large` = 650px tall (433×650 portrait — way under
        // the 1350-tall canvas), `large2x` = 1300px tall (still under).
        // Only `original` is reliably ≥ canvas dimensions.
        imageUrl: photo.src.original,
        thumbnailUrl: photo.src.medium,
        width: photo.width,
        height: photo.height,
        photographer: photo.photographer,
        sourceUrl: photo.url,
        description: photo.alt || null,
        providerId: String(photo.id),
      });
    }
  }
  return out;
}
