/**
 * Spec 65.8 — Pixabay API adapter types.
 *
 * Pixabay auth uses `?key=<apiKey>` in the query string (no header).
 * Pixabay License: free for commercial use, no attribution required —
 * cleanest license of the three providers.
 *
 * Rate limit: 100 req/min by default per Pixabay docs (verified 2026-05-26).
 */
import { z } from "zod";

export interface PixabayCredentials {
  /** Pixabay API key from https://pixabay.com/api/docs/ */
  apiKey: string;
}

export interface PixabaySearchInput {
  query: string;
  perPage?: number;
  /**
   * Pixabay supports `all | photo | illustration | vector`. We default to
   * `photo` — illustrations rarely fit emotional-editorial Family B scenes.
   */
  imageType?: "all" | "photo" | "illustration" | "vector";
  /** `all | horizontal | vertical`. Vertical matches our 4:5 carousels. */
  orientation?: "all" | "horizontal" | "vertical";
  /** Minimum image width (Pixabay requires ≥1280 for hi-res `largeImageURL`). */
  minWidth?: number;
}

/**
 * Raw Pixabay API hit shape. Mirrors
 * https://pixabay.com/api/docs/.
 *
 * `webformatURL` is the ~640w watermarked preview (NEVER store this — only
 * for inline LLM-vision input). `largeImageURL` is the ~1280w full-size
 * URL we actually stage to R2.
 */
export const pixabayHitSchema = z.object({
  id: z.number(),
  pageURL: z.string().url(),
  type: z.string(),
  tags: z.string(),
  previewURL: z.string().url(),
  webformatURL: z.string().url(),
  webformatWidth: z.number(),
  webformatHeight: z.number(),
  largeImageURL: z.string().url(),
  imageWidth: z.number(),
  imageHeight: z.number(),
  user: z.string(),
  user_id: z.number(),
});

export type PixabayHit = z.infer<typeof pixabayHitSchema>;

export const pixabaySearchResponseSchema = z.object({
  total: z.number(),
  totalHits: z.number(),
  hits: z.array(pixabayHitSchema),
});

export type PixabaySearchResponse = z.infer<typeof pixabaySearchResponseSchema>;
