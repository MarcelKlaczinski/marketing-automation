/**
 * Spec 65.8 — Pexels client smoke tests.
 *
 * Covers: search shape, auth-error mapping (401), rate-limit-error mapping (429),
 * 5xx retry-then-fail, request-header authorization.
 *
 * Uses `globalThis.fetch` mock — Pexels client has no module-level cache, so no
 * unique-credential ceremony needed.
 */
import { describe, expect, it, mock } from "bun:test";
import {
  PexelsAuthError,
  PexelsRateLimitError,
  searchPexelsPhotos,
} from "../src/client.ts";

const TEST_CREDS = { apiKey: "test-pexels-api-key" };

function makeSearchResponse(photoCount: number) {
  const photos = Array.from({ length: photoCount }, (_, i) => ({
    id: 1000 + i,
    width: 1280,
    height: 1600,
    url: `https://www.pexels.com/photo/${1000 + i}/`,
    photographer: `Photographer ${i}`,
    photographer_url: `https://www.pexels.com/@photographer-${i}/`,
    alt: `Sample photo ${i}`,
    src: {
      original: `https://images.pexels.com/photos/${1000 + i}/original.jpg`,
      large: `https://images.pexels.com/photos/${1000 + i}/large.jpg`,
      medium: `https://images.pexels.com/photos/${1000 + i}/medium.jpg`,
    },
  }));
  return new Response(
    JSON.stringify({
      total_results: photoCount,
      page: 1,
      per_page: photoCount,
      photos,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("searchPexelsPhotos", () => {
  it("returns parsed photos with the expected shape", async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeSearchResponse(3))) as unknown as typeof fetch;
    const photos = await searchPexelsPhotos(TEST_CREDS, { query: "nature", perPage: 3 });
    expect(photos.length).toBe(3);
    expect(photos[0]?.photographer).toBe("Photographer 0");
    expect(photos[0]?.src.medium).toContain("medium.jpg");
  });

  it("sends Authorization header with the API key", async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(makeSearchResponse(1));
    }) as unknown as typeof fetch;
    await searchPexelsPhotos(TEST_CREDS, { query: "nature", perPage: 1 });
    expect(capturedHeaders?.get("Authorization")).toBe("test-pexels-api-key");
  });

  it("propagates orientation + perPage to query string", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(makeSearchResponse(1));
    }) as unknown as typeof fetch;
    await searchPexelsPhotos(TEST_CREDS, { query: "sunset", perPage: 7, orientation: "portrait" });
    expect(capturedUrl).toContain("query=sunset");
    expect(capturedUrl).toContain("per_page=7");
    expect(capturedUrl).toContain("orientation=portrait");
  });

  it("throws PexelsAuthError on HTTP 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as unknown as typeof fetch;
    await expect(searchPexelsPhotos(TEST_CREDS, { query: "x" })).rejects.toBeInstanceOf(
      PexelsAuthError,
    );
  });

  it("throws PexelsRateLimitError on HTTP 429 with reset header parsed", async () => {
    const resetEpochSec = Math.floor(Date.now() / 1000) + 3600;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "X-Ratelimit-Reset": String(resetEpochSec) },
        }),
      ),
    ) as unknown as typeof fetch;
    try {
      await searchPexelsPhotos(TEST_CREDS, { query: "x" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PexelsRateLimitError);
      if (err instanceof PexelsRateLimitError) {
        expect(err.resetAt).toBeInstanceOf(Date);
        expect(err.resetAt?.getTime()).toBe(resetEpochSec * 1000);
      }
    }
  });

  it("retries 5xx up to 3 times then throws", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response("Server Error", { status: 503 }));
    }) as unknown as typeof fetch;
    await expect(searchPexelsPhotos(TEST_CREDS, { query: "x" })).rejects.toThrow(/server error/i);
    expect(callCount).toBe(3);
  });
});
