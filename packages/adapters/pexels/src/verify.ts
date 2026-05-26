/**
 * Spec 65.8 — Pexels credential verifier.
 *
 * Read-only smoke-test for the installer flow. Searches for a known
 * query and returns counts so Marcel sees that the key is live.
 */
import { PexelsAuthError, PexelsRateLimitError, searchPexelsPhotos } from "./client.ts";
import type { PexelsCredentials } from "./types.ts";

export async function verifyPexels(
  creds: PexelsCredentials,
): Promise<{ ok: boolean; message: string }> {
  try {
    const photos = await searchPexelsPhotos(creds, { query: "nature", perPage: 1 });
    return {
      ok: true,
      message: `OK — Pexels credentials valid, sample search returned ${photos.length} photo(s)`,
    };
  } catch (err) {
    if (err instanceof PexelsAuthError) {
      return { ok: false, message: `Auth failed: ${err.message}` };
    }
    if (err instanceof PexelsRateLimitError) {
      return {
        ok: false,
        message: `Rate-limit hit: ${err.message}${err.resetAt ? ` (resets ${err.resetAt.toISOString()})` : ""}`,
      };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
