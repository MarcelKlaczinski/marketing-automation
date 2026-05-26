/**
 * Spec 65.8 — Unsplash provider adapter for the photographic subsystem.
 *
 * Sets `unsplashDownloadLocationUrl` so the R2-stage step can fire the
 * download-tracking ping per Unsplash TOS once the image is actually staged.
 */
import {
  searchUnsplashPhotos,
  type UnsplashCredentials,
} from "@marketing-auto/adapter-unsplash";
import type { ProviderSearchResult } from "../types.ts";

export async function searchUnsplashAsProvider(
  creds: UnsplashCredentials,
  queries: string[],
  perQuery = 5,
): Promise<ProviderSearchResult[]> {
  const allResults = await Promise.allSettled(
    queries.map((q) =>
      searchUnsplashPhotos(creds, {
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
        provider: "unsplash",
        imageUrl: photo.urls.regular,
        thumbnailUrl: photo.urls.small,
        width: photo.width,
        height: photo.height,
        photographer: photo.user.name,
        sourceUrl: photo.links.html,
        description: photo.description ?? photo.alt_description ?? null,
        providerId: photo.id,
        unsplashDownloadLocationUrl: photo.links.download_location,
      });
    }
  }
  return out;
}
