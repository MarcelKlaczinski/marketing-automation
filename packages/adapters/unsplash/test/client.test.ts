/**
 * Spec 65.8 — Unsplash client smoke tests.
 *
 * Covers: search shape, Client-ID header auth, 401 mapping, 429 mapping,
 * 5xx retry-then-fail, triggerUnsplashDownload is non-throwing.
 */
import { describe, expect, it, mock } from "bun:test";
import {
  UnsplashAuthError,
  UnsplashRateLimitError,
  searchUnsplashPhotos,
  triggerUnsplashDownload,
} from "../src/client.ts";

const TEST_CREDS = { accessKey: "test-unsplash-access-key" };

function makeSearchResponse(photoCount: number) {
  const results = Array.from({ length: photoCount }, (_, i) => ({
    id: `id-${i}`,
    width: 4000,
    height: 5000,
    description: `Description ${i}`,
    alt_description: `Alt ${i}`,
    urls: {
      raw: `https://images.unsplash.com/raw-${i}`,
      full: `https://images.unsplash.com/full-${i}`,
      regular: `https://images.unsplash.com/regular-${i}`,
      small: `https://images.unsplash.com/small-${i}`,
      thumb: `https://images.unsplash.com/thumb-${i}`,
    },
    links: {
      html: `https://unsplash.com/photos/id-${i}`,
      download: `https://unsplash.com/photos/id-${i}/download`,
      download_location: `https://api.unsplash.com/photos/id-${i}/download`,
    },
    user: {
      id: `user-${i}`,
      name: `User ${i}`,
      username: `user${i}`,
      links: { html: `https://unsplash.com/@user${i}` },
    },
  }));
  return new Response(
    JSON.stringify({ total: photoCount, total_pages: 1, results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("searchUnsplashPhotos", () => {
  it("returns parsed photos with photographer + sourceUrl shape", async () => {
    globalThis.fetch = mock(() => Promise.resolve(makeSearchResponse(2))) as unknown as typeof fetch;
    const photos = await searchUnsplashPhotos(TEST_CREDS, { query: "nature", perPage: 2 });
    expect(photos.length).toBe(2);
    expect(photos[0]?.user.name).toBe("User 0");
    expect(photos[0]?.links.html).toContain("unsplash.com/photos/id-0");
  });

  it("uses Client-ID auth header", async () => {
    const captured: { auth: string | null } = { auth: null };
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      captured.auth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(makeSearchResponse(1));
    }) as unknown as typeof fetch;
    await searchUnsplashPhotos(TEST_CREDS, { query: "x" });
    expect(captured.auth).toBe("Client-ID test-unsplash-access-key");
  });

  it("throws UnsplashAuthError on HTTP 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Forbidden", { status: 403 })),
    ) as unknown as typeof fetch;
    await expect(searchUnsplashPhotos(TEST_CREDS, { query: "x" })).rejects.toBeInstanceOf(
      UnsplashAuthError,
    );
  });

  it("throws UnsplashRateLimitError on HTTP 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "X-Ratelimit-Remaining": "0" },
        }),
      ),
    ) as unknown as typeof fetch;
    await expect(searchUnsplashPhotos(TEST_CREDS, { query: "x" })).rejects.toBeInstanceOf(
      UnsplashRateLimitError,
    );
  });

  it("retries 5xx up to 3 times then throws", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
    }) as unknown as typeof fetch;
    await expect(searchUnsplashPhotos(TEST_CREDS, { query: "x" })).rejects.toThrow();
    expect(callCount).toBe(3);
  });
});

describe("triggerUnsplashDownload", () => {
  it("swallows fetch errors without throwing", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    // must not throw
    await triggerUnsplashDownload(TEST_CREDS, "https://api.unsplash.com/photos/x/download");
    expect(true).toBe(true);
  });

  it("sends Client-ID header on download trigger", async () => {
    const captured: { auth: string | null } = { auth: null };
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      captured.auth = new Headers(init?.headers).get("Authorization");
      return Promise.resolve(new Response("OK", { status: 200 }));
    }) as unknown as typeof fetch;
    await triggerUnsplashDownload(TEST_CREDS, "https://api.unsplash.com/photos/x/download");
    expect(captured.auth).toBe("Client-ID test-unsplash-access-key");
  });
});
