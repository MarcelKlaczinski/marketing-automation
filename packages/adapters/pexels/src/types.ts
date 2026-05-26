/**
 * Spec 65.8 — Pexels API adapter types.
 *
 * Pexels' Search API returns a list of photos with `src.large` for full-size
 * use and `src.medium` for thumbnail/LLM-vision inputs. We map their shape
 * onto the project-wide `ProviderSearchResult` discriminated union consumed
 * by `packages/social/src/photographic/`.
 *
 * License: Pexels content is free to use with no attribution required. We
 * still capture `photographer` for optional credit lines.
 *
 * Rate limit: 200 req/h, 20k req/month on free tier (verified 2026-05-26).
 */
import { z } from "zod";

export interface PexelsCredentials {
  /** Pexels API key from https://www.pexels.com/api/ */
  apiKey: string;
}

/**
 * Search parameters. `orientation: "portrait"` matches the 4:5 carousel
 * aspect ratio we render at. `perPage` defaults to 5 per query.
 */
export interface PexelsSearchInput {
  query: string;
  perPage?: number;
  /** Provider-side orientation hint — `portrait` favours tall crops. */
  orientation?: "portrait" | "landscape" | "square";
}

/**
 * Raw Pexels API photo shape. Mirrors
 * https://www.pexels.com/api/documentation/#photos-search.
 * `src.large` is ~2x the size of `src.medium` and both are JPEG.
 */
export const pexelsPhotoSchema = z.object({
  id: z.number(),
  width: z.number(),
  height: z.number(),
  url: z.string().url(),
  photographer: z.string(),
  photographer_url: z.string().url(),
  alt: z.string().optional().default(""),
  src: z.object({
    original: z.string().url(),
    large: z.string().url(),
    medium: z.string().url(),
    portrait: z.string().url().optional(),
  }),
});

export type PexelsPhoto = z.infer<typeof pexelsPhotoSchema>;

export const pexelsSearchResponseSchema = z.object({
  total_results: z.number(),
  page: z.number(),
  per_page: z.number(),
  photos: z.array(pexelsPhotoSchema),
});

export type PexelsSearchResponse = z.infer<typeof pexelsSearchResponseSchema>;
