/**
 * Spec 65.8 — Pixabay client smoke tests.
 *
 * Covers: search shape, query-string auth, 400+"Invalid API key" body mapping
 * to PixabayAuthError, 429 mapping, 5xx retry-then-fail, default image_type=photo
 * + orientation=vertical applied.
 */
import { describe, expect, it, mock } from "bun:test";
import {
  PixabayAuthError,
  PixabayRateLimitError,
  searchPixabayHits,
} from "../src/client.ts";

const TEST_CREDS = { apiKey: "test-pixabay-api-key" };

function makeSearchResponse(hitCount: number) {
  const hits = Array.from({ length: hitCount }, (_, i) => ({
    id: 5000 + i,
    pageURL: `https://pixabay.com/photos/sample-${i}/`,
    type: "photo",
    tags: "nature, sunset, landscape",
    previewURL: `https://cdn.pixabay.com/photo/${5000 + i}-preview.jpg`,
    webformatURL: `https://cdn.pixabay.com/photo/${5000 + i}-640.jpg`,
    webformatWidth: 640,
    webformatHeight: 800,
    largeImageURL: `https://cdn.pixabay.com/photo/${5000 + i}-1280.jpg`,
    imageWidth: 1280,
    imageHeight: 1600,
    user: `User${i}`,
    user_id: 9000 + i,
  }));
  return new Response(
    JSON.stringify({ total: hitCount, totalHits: hitCount, hits }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("searchPixabayHits", () => {
  it("returns parsed hits with the expected shape", async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeSearchResponse(3))) as unknown as typeof fetch;
    const hits = await searchPixabayHits(TEST_CREDS, { query: "nature", perPage: 3 });
    expect(hits.length).toBe(3);
    expect(hits[0]?.largeImageURL).toContain("1280.jpg");
    expect(hits[0]?.user).toBe("User0");
  });

  it("sends key + defaults in query string", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(makeSearchResponse(3));
    }) as unknown as typeof fetch;
    await searchPixabayHits(TEST_CREDS, { query: "sunset", perPage: 3 });
    expect(capturedUrl).toContain("key=test-pixabay-api-key");
    expect(capturedUrl).toContain("q=sunset");
    expect(capturedUrl).toContain("image_type=photo");
    expect(capturedUrl).toContain("orientation=vertical");
    expect(capturedUrl).toContain("safesearch=true");
  });

  it("clamps perPage to minimum 3 per Pixabay constraint", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(makeSearchResponse(3));
    }) as unknown as typeof fetch;
    await searchPixabayHits(TEST_CREDS, { query: "x", perPage: 1 });
    expect(capturedUrl).toContain("per_page=3");
  });

  it('throws PixabayAuthError on HTTP 400 + "Invalid API key" body', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("[ERROR 400] Invalid API key", { status: 400 })),
    ) as unknown as typeof fetch;
    await expect(searchPixabayHits(TEST_CREDS, { query: "x" })).rejects.toBeInstanceOf(
      PixabayAuthError,
    );
  });

  it("throws plain Error on non-auth 400 (e.g. malformed query)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("[ERROR 400] q parameter missing", { status: 400 })),
    ) as unknown as typeof fetch;
    await expect(searchPixabayHits(TEST_CREDS, { query: "x" })).rejects.toThrow(/bad request/i);
  });

  it("throws PixabayRateLimitError on HTTP 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Too Many Requests", { status: 429 })),
    ) as unknown as typeof fetch;
    await expect(searchPixabayHits(TEST_CREDS, { query: "x" })).rejects.toBeInstanceOf(
      PixabayRateLimitError,
    );
  });

  it("retries 5xx up to 3 times then throws", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response("Server Error", { status: 500 }));
    }) as unknown as typeof fetch;
    await expect(searchPixabayHits(TEST_CREDS, { query: "x" })).rejects.toThrow();
    expect(callCount).toBe(3);
  });
});
