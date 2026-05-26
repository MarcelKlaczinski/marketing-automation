/**
 * Spec 65.8 — Unsplash API client.
 *
 * Auth: `Authorization: Client-ID <key>` (NOT bearer).
 * Single-attempt fetch with 5xx + network-error retry × 3 (500/1000/2000ms).
 * 4xx fails fast.
 */
import {
  type UnsplashCredentials,
  type UnsplashPhoto,
  type UnsplashSearchInput,
  unsplashSearchResponseSchema,
} from "./types.ts";

export const UNSPLASH_API_BASE = "https://api.unsplash.com";

export class UnsplashAuthError extends Error {
  public readonly unsplashErrorKind = "auth" as const;
  constructor(message: string) {
    super(message);
    this.name = "UnsplashAuthError";
  }
}

export class UnsplashRateLimitError extends Error {
  public readonly unsplashErrorKind = "rate_limit" as const;
  public readonly resetAt: Date | null;
  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = "UnsplashRateLimitError";
    this.resetAt = resetAt;
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000, 2000] as const;

async function doGet(path: string, creds: UnsplashCredentials): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${UNSPLASH_API_BASE}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Client-ID ${creds.accessKey}`,
          "Accept-Version": "v1",
        },
      });
      if (res.status === 401 || res.status === 403) {
        throw new UnsplashAuthError(`Unsplash auth failed: HTTP ${res.status}`);
      }
      if (res.status === 429) {
        const resetHeader = res.headers.get("X-Ratelimit-Remaining");
        // Unsplash doesn't publish an explicit reset header; the hourly window
        // is well-known but we leave resetAt null since we can't be precise.
        throw new UnsplashRateLimitError(
          `Unsplash rate-limited: HTTP 429 (remaining=${resetHeader ?? "unknown"})`,
        );
      }
      if (res.status >= 500) {
        lastErr = new Error(`Unsplash server error: HTTP ${res.status}`);
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(BACKOFF_MS[attempt] ?? 2000);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new Error(`Unsplash request failed: HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (err instanceof UnsplashAuthError || err instanceof UnsplashRateLimitError) {
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
  throw lastErr ?? new Error("Unsplash request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchUnsplashPhotos(
  creds: UnsplashCredentials,
  input: UnsplashSearchInput,
): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams();
  params.set("query", input.query);
  params.set("per_page", String(input.perPage ?? 5));
  if (input.orientation) params.set("orientation", input.orientation);
  const res = await doGet(`/search/photos?${params.toString()}`, creds);
  const json = await res.json();
  const parsed = unsplashSearchResponseSchema.parse(json);
  return parsed.results;
}

/**
 * Per Unsplash API guidelines, calling the download endpoint when a photo is
 * actually used by the application is a soft requirement (tracks usage for the
 * photographer). Fire-and-forget — failure must not break the user flow.
 */
export async function triggerUnsplashDownload(
  creds: UnsplashCredentials,
  downloadLocationUrl: string,
): Promise<void> {
  try {
    await fetch(downloadLocationUrl, {
      method: "GET",
      headers: { Authorization: `Client-ID ${creds.accessKey}` },
    });
  } catch {
    // swallow — best-effort attribution side-effect
  }
}
