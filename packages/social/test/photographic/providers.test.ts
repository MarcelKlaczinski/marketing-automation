/**
 * Spec 65.8 — Per-provider adapter mapping tests + parallel-search composer.
 *
 * Mocks `globalThis.fetch` to return canned Pexels/Unsplash/Pixabay payloads;
 * asserts each adapter normalizes onto `ProviderSearchResult` correctly and
 * the composer dedups by (provider, providerId).
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { searchAllProviders } from "../../src/photographic/providers/index.ts";
import { searchPexelsAsProvider } from "../../src/photographic/providers/pexels.ts";
import { searchPixabayAsProvider } from "../../src/photographic/providers/pixabay.ts";
import { searchUnsplashAsProvider } from "../../src/photographic/providers/unsplash.ts";

const PEXELS_CREDS = { apiKey: "pk" };
const UNSPLASH_CREDS = { accessKey: "uk" };
const PIXABAY_CREDS = { apiKey: "px" };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function pexelsResponse(ids: number[]) {
  return new Response(
    JSON.stringify({
      total_results: ids.length,
      page: 1,
      per_page: ids.length,
      photos: ids.map((id) => ({
        id,
        width: 1280,
        height: 1600,
        url: `https://www.pexels.com/photo/${id}/`,
        photographer: `P-${id}`,
        photographer_url: `https://www.pexels.com/@p-${id}/`,
        alt: `alt ${id}`,
        src: {
          original: `https://images.pexels.com/photos/${id}/original.jpg`,
          large: `https://images.pexels.com/photos/${id}/large.jpg`,
          medium: `https://images.pexels.com/photos/${id}/medium.jpg`,
        },
      })),
    }),
    { status: 200 },
  );
}

function unsplashResponse(ids: string[]) {
  return new Response(
    JSON.stringify({
      total: ids.length,
      total_pages: 1,
      results: ids.map((id) => ({
        id,
        width: 4000,
        height: 5000,
        description: `desc ${id}`,
        alt_description: null,
        urls: {
          raw: `https://images.unsplash.com/raw-${id}`,
          full: `https://images.unsplash.com/full-${id}`,
          regular: `https://images.unsplash.com/regular-${id}`,
          small: `https://images.unsplash.com/small-${id}`,
          thumb: `https://images.unsplash.com/thumb-${id}`,
        },
        links: {
          html: `https://unsplash.com/photos/${id}`,
          download: `https://unsplash.com/photos/${id}/download`,
          download_location: `https://api.unsplash.com/photos/${id}/download`,
        },
        user: { id: `u-${id}`, name: `U-${id}`, username: `u-${id}` },
      })),
    }),
    { status: 200 },
  );
}

function pixabayResponse(ids: number[]) {
  return new Response(
    JSON.stringify({
      total: ids.length,
      totalHits: ids.length,
      hits: ids.map((id) => ({
        id,
        pageURL: `https://pixabay.com/photos/${id}/`,
        type: "photo",
        tags: "nature, sunset",
        previewURL: `https://cdn.pixabay.com/photo/${id}-preview.jpg`,
        webformatURL: `https://cdn.pixabay.com/photo/${id}-640.jpg`,
        webformatWidth: 640,
        webformatHeight: 800,
        largeImageURL: `https://cdn.pixabay.com/photo/${id}-1280.jpg`,
        imageWidth: 1280,
        imageHeight: 1600,
        user: `pixUser${id}`,
        user_id: 9000 + id,
      })),
    }),
    { status: 200 },
  );
}

describe("searchPexelsAsProvider", () => {
  it("normalizes raw Pexels photos onto ProviderSearchResult", async () => {
    globalThis.fetch = mock(() => Promise.resolve(pexelsResponse([10, 11]))) as unknown as typeof fetch;
    const results = await searchPexelsAsProvider(PEXELS_CREDS, ["nature"]);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      provider: "pexels",
      // Spec 65.16 V1.6-followup — Pexels mapper now picks `src.original`
      // (full-res) so `convertImageToWebp` can downscale to 1620w retina-safely.
      // `src.large` (433×650 portrait) was upscaling to 1080×1350 → matschig.
      imageUrl: "https://images.pexels.com/photos/10/original.jpg",
      thumbnailUrl: "https://images.pexels.com/photos/10/medium.jpg",
      photographer: "P-10",
      providerId: "10",
    });
  });

  it("collects across multiple queries", async () => {
    let n = 0;
    globalThis.fetch = mock(() => {
      n++;
      return Promise.resolve(pexelsResponse([100 + n]));
    }) as unknown as typeof fetch;
    const results = await searchPexelsAsProvider(PEXELS_CREDS, ["q1", "q2", "q3"]);
    expect(results.length).toBe(3);
  });

  it("skips failed queries (Promise.allSettled)", async () => {
    // Fail q2 deterministically regardless of retry count by matching the URL.
    globalThis.fetch = mock((url: string) => {
      if (url.includes("query=q2")) {
        return Promise.resolve(new Response("error", { status: 500 }));
      }
      return Promise.resolve(pexelsResponse([100]));
    }) as unknown as typeof fetch;
    const results = await searchPexelsAsProvider(PEXELS_CREDS, ["q1", "q2", "q3"]);
    // q2 retries 3× then fails — q1 + q3 succeed (1 result each, dedup before
    // composer-level dedup so same id appears twice here).
    expect(results.length).toBe(2);
  });
});

describe("searchUnsplashAsProvider", () => {
  it("attaches the unsplashDownloadLocationUrl for later attribution-tracking", async () => {
    globalThis.fetch = mock(() => Promise.resolve(unsplashResponse(["abc"]))) as unknown as typeof fetch;
    const results = await searchUnsplashAsProvider(UNSPLASH_CREDS, ["nature"]);
    expect(results[0]?.unsplashDownloadLocationUrl).toBe(
      "https://api.unsplash.com/photos/abc/download",
    );
    expect(results[0]?.photographer).toBe("U-abc");
    expect(results[0]?.sourceUrl).toBe("https://unsplash.com/photos/abc");
  });

  it("falls back from description to alt_description when null", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            total: 1,
            total_pages: 1,
            results: [
              {
                id: "x",
                width: 1,
                height: 1,
                description: null,
                alt_description: "alt fallback",
                urls: { raw: "https://u/r", full: "https://u/f", regular: "https://u/reg", small: "https://u/s", thumb: "https://u/t" },
                links: { html: "https://u/p", download: "https://u/d", download_location: "https://u/dl" },
                user: { id: "u", name: "Name", username: "n" },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;
    const results = await searchUnsplashAsProvider(UNSPLASH_CREDS, ["x"]);
    expect(results[0]?.description).toBe("alt fallback");
  });
});

describe("searchPixabayAsProvider", () => {
  it("normalizes hits and uses largeImageURL for the canonical image", async () => {
    globalThis.fetch = mock(() => Promise.resolve(pixabayResponse([501, 502]))) as unknown as typeof fetch;
    const results = await searchPixabayAsProvider(PIXABAY_CREDS, ["nature"]);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      provider: "pixabay",
      imageUrl: "https://cdn.pixabay.com/photo/501-1280.jpg",
      photographer: "pixUser501",
      providerId: "501",
      sourceUrl: "https://pixabay.com/photos/501/",
    });
  });
});

describe("searchAllProviders", () => {
  it("fans out to all 3 providers when credentials present", async () => {
    let pexelsCount = 0;
    let unsplashCount = 0;
    let pixabayCount = 0;
    globalThis.fetch = mock((url: string) => {
      if (url.includes("pexels.com")) {
        pexelsCount++;
        return Promise.resolve(pexelsResponse([10]));
      }
      if (url.includes("unsplash.com")) {
        unsplashCount++;
        return Promise.resolve(unsplashResponse(["u1"]));
      }
      if (url.includes("pixabay.com")) {
        pixabayCount++;
        return Promise.resolve(pixabayResponse([500]));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }) as unknown as typeof fetch;

    const results = await searchAllProviders(
      { pexels: PEXELS_CREDS, unsplash: UNSPLASH_CREDS, pixabay: PIXABAY_CREDS },
      { queries: ["nature"], perQuery: 1 },
    );
    expect(results.length).toBe(3);
    expect(pexelsCount).toBe(1);
    expect(unsplashCount).toBe(1);
    expect(pixabayCount).toBe(1);
    const providers = results.map((r) => r.provider).sort();
    expect(providers).toEqual(["pexels", "pixabay", "unsplash"]);
  });

  it("skips providers with null credentials", async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes("pexels.com")) return Promise.resolve(pexelsResponse([10]));
      return Promise.resolve(new Response("", { status: 404 }));
    }) as unknown as typeof fetch;

    const results = await searchAllProviders(
      { pexels: PEXELS_CREDS, unsplash: null, pixabay: null },
      { queries: ["nature"], perQuery: 1 },
    );
    expect(results.length).toBe(1);
    expect(results[0]?.provider).toBe("pexels");
  });

  it("dedups by (provider, providerId)", async () => {
    // Both queries return the same Pexels photo — dedup should remove the second.
    globalThis.fetch = mock(() => Promise.resolve(pexelsResponse([777]))) as unknown as typeof fetch;
    const results = await searchAllProviders(
      { pexels: PEXELS_CREDS, unsplash: null, pixabay: null },
      { queries: ["query1", "query2"], perQuery: 1 },
    );
    expect(results.length).toBe(1);
    expect(results[0]?.providerId).toBe("777");
  });

  it("tolerates one provider failing (Promise.allSettled at the fan-out)", async () => {
    globalThis.fetch = mock((url: string) => {
      if (url.includes("pexels.com")) return Promise.reject(new Error("pexels down"));
      if (url.includes("unsplash.com")) return Promise.resolve(unsplashResponse(["u1"]));
      return Promise.resolve(new Response("", { status: 404 }));
    }) as unknown as typeof fetch;

    const results = await searchAllProviders(
      { pexels: PEXELS_CREDS, unsplash: UNSPLASH_CREDS, pixabay: null },
      { queries: ["nature"], perQuery: 1 },
    );
    expect(results.length).toBe(1);
    expect(results[0]?.provider).toBe("unsplash");
  });
});
