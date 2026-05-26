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
        imageUrl: photo.src.large,
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
