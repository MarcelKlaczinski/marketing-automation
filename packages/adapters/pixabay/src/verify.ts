/**
 * Spec 65.8 — Pixabay credential verifier.
 */
import { PixabayAuthError, PixabayRateLimitError, searchPixabayHits } from "./client.ts";
import type { PixabayCredentials } from "./types.ts";

export async function verifyPixabay(
  creds: PixabayCredentials,
): Promise<{ ok: boolean; message: string }> {
  try {
    const hits = await searchPixabayHits(creds, { query: "nature", perPage: 3 });
    return {
      ok: true,
      message: `OK — Pixabay credentials valid, sample search returned ${hits.length} hit(s)`,
    };
  } catch (err) {
    if (err instanceof PixabayAuthError) {
      return { ok: false, message: `Auth failed: ${err.message}` };
    }
    if (err instanceof PixabayRateLimitError) {
      return { ok: false, message: `Rate-limit hit: ${err.message}` };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
