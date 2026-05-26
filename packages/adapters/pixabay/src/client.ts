/**
 * Spec 65.8 — Pixabay API client.
 *
 * Auth via `?key=<apiKey>` query string. Pixabay returns HTTP 400 on
 * invalid keys (no 401/403 differentiation) so we map all 4xx-with-error-body
 * to PixabayAuthError. Single-attempt fetch with 5xx + network-error retry
 * × 3 (500/1000/2000ms).
 */
import {
  type PixabayCredentials,
  type PixabayHit,
  type PixabaySearchInput,
  pixabaySearchResponseSchema,
} from "./types.ts";

export const PIXABAY_API_BASE = "https://pixabay.com/api";

export class PixabayAuthError extends Error {
  public readonly pixabayErrorKind = "auth" as const;
  constructor(message: string) {
    super(message);
    this.name = "PixabayAuthError";
  }
}

export class PixabayRateLimitError extends Error {
  public readonly pixabayErrorKind = "rate_limit" as const;
  constructor(message: string) {
    super(message);
    this.name = "PixabayRateLimitError";
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000, 2000] as const;

async function doGet(path: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${PIXABAY_API_BASE}${path}`);
      if (res.status === 400) {
        // Pixabay returns 400 + plain-text body "[ERROR 400] Invalid API key"
        const body = await res.text().catch(() => "");
        if (/invalid api key/i.test(body)) {
          throw new PixabayAuthError(`Pixabay auth failed: ${body}`);
        }
        throw new Error(`Pixabay bad request: ${body || "HTTP 400"}`);
      }
      if (res.status === 429) {
        throw new PixabayRateLimitError("Pixabay rate-limited: HTTP 429");
      }
      if (res.status >= 500) {
        lastErr = new Error(`Pixabay server error: HTTP ${res.status}`);
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(BACKOFF_MS[attempt] ?? 2000);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        throw new Error(`Pixabay request failed: HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (err instanceof PixabayAuthError || err instanceof PixabayRateLimitError) {
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
  throw lastErr ?? new Error("Pixabay request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchPixabayHits(
  creds: PixabayCredentials,
  input: PixabaySearchInput,
): Promise<PixabayHit[]> {
  const params = new URLSearchParams();
  params.set("key", creds.apiKey);
  params.set("q", input.query);
  params.set("per_page", String(Math.max(input.perPage ?? 5, 3))); // Pixabay min is 3
  params.set("image_type", input.imageType ?? "photo");
  params.set("orientation", input.orientation ?? "vertical");
  if (input.minWidth) params.set("min_width", String(input.minWidth));
  params.set("safesearch", "true");
  const res = await doGet(`/?${params.toString()}`);
  const json = await res.json();
  const parsed = pixabaySearchResponseSchema.parse(json);
  return parsed.hits;
}
