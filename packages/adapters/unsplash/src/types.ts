/**
 * Spec 65.8 — Unsplash API adapter types.
 *
 * Unsplash auth uses the `Authorization: Client-ID <key>` header pattern
 * (NOT bearer). Their license requires attribution — every consumer must
 * surface `photographer` + `sourceUrl` (the photo's own page) somewhere.
 * We add it to Instagram captions per spec §3.12 Option B.
 *
 * Rate limit: 50 req/h on demo tier, 5000 req/h on production tier (verified
 * 2026-05-26). Demo tier is fine for Toolwiki's ~14 posts/month × ~4 image
 * slides = ~56 req/month.
 */
import { z } from "zod";

export interface UnsplashCredentials {
  /** Unsplash Access Key (client_id) from https://unsplash.com/developers */
  accessKey: string;
}

export interface UnsplashSearchInput {
  query: string;
  perPage?: number;
  orientation?: "portrait" | "landscape" | "squarish";
}

/**
 * Raw Unsplash API photo shape. Mirrors
 * https://unsplash.com/documentation#search-photos.
 *
 * `urls.regular` is ~1080w (great for our 1080×1350 canvas); `urls.small`
 * is ~400w for LLM-vision thumbnails. `links.html` is the canonical photo
 * page URL we MUST attribute to per Unsplash TOS.
 */
export const unsplashPhotoSchema = z.object({
  id: z.string(),
  width: z.number(),
  height: z.number(),
  description: z.string().nullable().optional(),
  alt_description: z.string().nullable().optional(),
  urls: z.object({
    raw: z.string().url(),
    full: z.string().url(),
    regular: z.string().url(),
    small: z.string().url(),
    thumb: z.string().url(),
  }),
  links: z.object({
    html: z.string().url(),
    download: z.string().url(),
    download_location: z.string().url(),
  }),
  user: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    links: z
      .object({
        html: z.string().url().optional(),
      })
      .optional(),
  }),
});

export type UnsplashPhoto = z.infer<typeof unsplashPhotoSchema>;

export const unsplashSearchResponseSchema = z.object({
  total: z.number(),
  total_pages: z.number(),
  results: z.array(unsplashPhotoSchema),
});

export type UnsplashSearchResponse = z.infer<typeof unsplashSearchResponseSchema>;
