/**
 * Spec 65.8 — Pexels API client.
 *
 * Vault-first credential resolution mirrors the Spec 64.20 GitHub-Inventory
 * adapter. Single-attempt fetch with 5xx + network-error retry × 3 (500/1000/2000ms).
 * 4xx fails fast.
 */
import {
  type PexelsCredentials,
  type PexelsPhoto,
  type PexelsSearchInput,
  pexelsSearchResponseSchema,
} from "./types.ts";

export const PEXELS_API_BASE = "https://api.pexels.com/v1";

export class PexelsAuthError extends Error {
  public readonly pexelsErrorKind = "auth" as const;
  constructor(message: string) {
    super(message);
    this.name = "PexelsAuthError";
  }
}

export class PexelsRateLimitError extends Error {
  public readonly pexelsErrorKind = "rate_limit" as const;
  public readonly resetAt: Date | null;
  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = "PexelsRateLimitError";
    this.resetAt = resetAt;
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000, 2000] as const;

async function doGet(path: string, creds: PexelsCredentials): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${PEXELS_API_BASE}${path}`, {
        method: "GET",
        headers: { Authorization: creds.apiKey },
      });
      if (res.status === 401 || res.status === 403) {
        throw new PexelsAuthError(`Pexels auth failed: HTTP ${res.status}`);
      }
      if (res.status === 429) {
        // X-Ratelimit-Reset (UTC epoch seconds) per Pexels docs.
        const resetHeader = res.headers.get("X-Ratelimit-Reset");
        const resetAt = resetHeader ? new Date(Number.parseInt(resetHeader, 10) * 1000) : null;
        throw new PexelsRateLimitError(`Pexels rate-limited: HTTP 429`, resetAt);
      }
      if (res.status >= 500) {
        lastErr = new Error(`Pexels server error: HTTP ${res.status}`);
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(BACKOFF_MS[attempt] ?? 2000);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new Error(`Pexels request failed: HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (err instanceof PexelsAuthError || err instanceof PexelsRateLimitError) {
        throw err;
      }
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 2000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Pexels request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search Pexels for photos matching the query.
 * Returns the raw `photos` array — provider-shape mapping happens upstream
 * in `packages/social/src/photographic/providers/`.
 */
export async function searchPexelsPhotos(
  creds: PexelsCredentials,
  input: PexelsSearchInput,
): Promise<PexelsPhoto[]> {
  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("per_page", String(input.perPage ?? 5));
  if (input.orientation) params.set("orientation", input.orientation);
  const res = await doGet(`/search?${params.toString()}`, creds);
  const json = await res.json();
  const parsed = pexelsSearchResponseSchema.parse(json);
  return parsed.photos;
}
