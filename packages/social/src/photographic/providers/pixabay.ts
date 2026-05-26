/**
 * Spec 65.8 — Pixabay provider adapter for the photographic subsystem.
 *
 * `photographer` is the Pixabay username (NOT a real name — Pixabay license
 * does not require attribution, this is informational only).
 */
import {
  searchPixabayHits,
  type PixabayCredentials,
} from "@marketing-auto/adapter-pixabay";
import type { ProviderSearchResult } from "../types.ts";

export async function searchPixabayAsProvider(
  creds: PixabayCredentials,
  queries: string[],
  perQuery = 5,
): Promise<ProviderSearchResult[]> {
  const allResults = await Promise.allSettled(
    queries.map((q) =>
      searchPixabayHits(creds, {
        query: q,
        perPage: Math.max(perQuery, 3),
        imageType: "photo",
        orientation: "vertical",
      }),
    ),
  );
  const out: ProviderSearchResult[] = [];
  for (const r of allResults) {
    if (r.status !== "fulfilled") continue;
    for (const hit of r.value) {
      out.push({
        provider: "pixabay",
        imageUrl: hit.largeImageURL,
        thumbnailUrl: hit.webformatURL,
        width: hit.imageWidth,
        height: hit.imageHeight,
        photographer: hit.user,
        sourceUrl: hit.pageURL,
        description: hit.tags || null,
        providerId: String(hit.id),
      });
    }
  }
  return out;
}
