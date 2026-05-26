/**
 * Spec 65.8 — Unsplash credential verifier.
 */
import {
  UnsplashAuthError,
  UnsplashRateLimitError,
  searchUnsplashPhotos,
} from "./client.ts";
import type { UnsplashCredentials } from "./types.ts";

export async function verifyUnsplash(
  creds: UnsplashCredentials,
): Promise<{ ok: boolean; message: string }> {
  try {
    const photos = await searchUnsplashPhotos(creds, { query: "nature", perPage: 1 });
    return {
      ok: true,
      message: `OK — Unsplash credentials valid, sample search returned ${photos.length} photo(s)`,
    };
  } catch (err) {
    if (err instanceof UnsplashAuthError) {
      return { ok: false, message: `Auth failed: ${err.message}` };
    }
    if (err instanceof UnsplashRateLimitError) {
      return {
        ok: false,
        message: `Rate-limit hit: ${err.message}`,
      };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
