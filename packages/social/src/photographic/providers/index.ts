/**
 * Spec 65.8 — Parallel-search composer.
 *
 * Per spec §3.9 Marcel chose parallel-search (vs sequential fallback) so the
 * Sonnet vision LLM gets the widest candidate pool to pick from across all
 * 3 providers. Rate-limit math at V1 scale (~14 posts/month × ~4 images ×
 * 3 queries × 3 providers ≈ 500 req/month) sits comfortably inside the
 * smallest free tier (Unsplash demo 50 req/h).
 */
import type { PexelsCredentials } from "@marketing-auto/adapter-pexels";
import type { PixabayCredentials } from "@marketing-auto/adapter-pixabay";
import type { UnsplashCredentials } from "@marketing-auto/adapter-unsplash";
import type { ProviderSearchResult } from "../types.ts";
import { searchPexelsAsProvider } from "./pexels.ts";
import { searchPixabayAsProvider } from "./pixabay.ts";
import { searchUnsplashAsProvider } from "./unsplash.ts";

export {
  searchPexelsAsProvider,
  searchPixabayAsProvider,
  searchUnsplashAsProvider,
};

export interface ParallelSearchCredentials {
  pexels: PexelsCredentials | null;
  unsplash: UnsplashCredentials | null;
  pixabay: PixabayCredentials | null;
}

export interface ParallelSearchInput {
  /** 1-3 LLM-generated query keywords. */
  queries: string[];
  /** Results per query per provider. Default 5. */
  perQuery?: number;
}

/**
 * Fan-out search to all configured providers, flatten into a single candidate
 * pool, dedup by `(provider, providerId)`. Providers with null credentials
 * are skipped silently — Marcel may want to disable one without re-deploying.
 */
export async function searchAllProviders(
  creds: ParallelSearchCredentials,
  input: ParallelSearchInput,
): Promise<ProviderSearchResult[]> {
  const tasks: Array<Promise<ProviderSearchResult[]>> = [];
  if (creds.pexels) tasks.push(searchPexelsAsProvider(creds.pexels, input.queries, input.perQuery));
  if (creds.unsplash) tasks.push(searchUnsplashAsProvider(creds.unsplash, input.queries, input.perQuery));
  if (creds.pixabay) tasks.push(searchPixabayAsProvider(creds.pixabay, input.queries, input.perQuery));

  const settled = await Promise.allSettled(tasks);
  const flat: ProviderSearchResult[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") flat.push(...r.value);
  }

  // Dedup by (provider, providerId) so the same photo isn't repeated when two
  // queries return the same hit.
  const seen = new Set<string>();
  const out: ProviderSearchResult[] = [];
  for (const r of flat) {
    const key = `${r.provider}:${r.providerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
