import { afterEach, describe, expect, it, mock } from "bun:test";
import { nanoBananaImageCostEur } from "@marketing-auto/cost-tracker";
import {
  callGeminiWithRetry,
  extractInlineImage,
  NANO_BANANA_MODELS,
  NanoBananaGenerationError,
  type GeminiResponse,
} from "../src/index.ts";
import { buildModelRequestBody } from "../src/model-inputs.ts";

const ORIGINAL_FETCH = globalThis.fetch;
type FetchFn = typeof globalThis.fetch;

function mockFetchResponses(responses: Array<{ status: number; body: unknown }>): {
  fetchMock: ReturnType<typeof mock>;
} {
  let i = 0;
  const fetchMock = mock(async () => {
    const next = responses[i] ?? responses[responses.length - 1]!;
    i++;
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as FetchFn;
  return { fetchMock };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ─── Request body shape (Spec 64.6b: responseFormat.image) ────────────────────

describe("buildModelRequestBody", () => {
  it("uses generationConfig.responseFormat.image.{aspectRatio,imageSize} per Gemini docs", () => {
    const body = buildModelRequestBody({
      projectId: "p1",
      operation: "hero-image-generation",
      model: "nano-banana-2",
      prompt: "Editorial flatlay",
      aspectRatio: "16:9",
      resolution: "1k",
      outputFormat: "webp",
      seed: 42,
      storagePrefix: "toolwiki/articles/hero",
      estimatedCostEur: 0.1,
    });

    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Editorial flatlay" }] }]);

    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.candidateCount).toBe(1);
    expect(gen.seed).toBe(42);
    expect(gen.responseModalities).toEqual(["TEXT", "IMAGE"]);

    const responseFormat = gen.responseFormat as Record<string, unknown>;
    const image = responseFormat.image as Record<string, unknown>;
    expect(image.aspectRatio).toBe("16:9");
    expect(image.imageSize).toBe("1K");
  });

  it("omits seed when not provided", () => {
    const body = buildModelRequestBody({
      projectId: "p1",
      operation: "hero-image-generation",
      model: "nano-banana-2",
      prompt: "x",
      storagePrefix: "toolwiki/hero",
      estimatedCostEur: 0.1,
    });
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.seed).toBeUndefined();
  });
});

// ─── Resolution routing (Spec 64.6b) ──────────────────────────────────────────

describe("buildModelRequestBody — resolution routing (Spec 64.6b)", () => {
  function imageSizeFor(resolution: "0.5k" | "1k" | "2k" | "4k", model: "nano-banana-2" | "nano-banana-pro" = "nano-banana-2") {
    const body = buildModelRequestBody({
      projectId: "p",
      operation: "hero-image-generation",
      model,
      prompt: "x",
      resolution,
      storagePrefix: "toolwiki/hero",
      estimatedCostEur: 0.1,
    });
    const gen = body.generationConfig as Record<string, unknown>;
    const responseFormat = gen.responseFormat as Record<string, unknown>;
    return (responseFormat.image as Record<string, unknown>).imageSize;
  }

  it("sends imageSize='512' for resolution '0.5k' (Flash)", () => {
    expect(imageSizeFor("0.5k")).toBe("512");
  });

  it("sends imageSize='1K' for resolution '1k'", () => {
    expect(imageSizeFor("1k")).toBe("1K");
  });

  it("sends imageSize='2K' for resolution '2k'", () => {
    expect(imageSizeFor("2k")).toBe("2K");
  });

  it("sends imageSize='4K' for resolution '4k'", () => {
    expect(imageSizeFor("4k")).toBe("4K");
  });

  it("defaults to '1K' when resolution is omitted", () => {
    const body = buildModelRequestBody({
      projectId: "p",
      operation: "hero-image-generation",
      model: "nano-banana-2",
      prompt: "x",
      storagePrefix: "toolwiki/hero",
      estimatedCostEur: 0.1,
    });
    const gen = body.generationConfig as Record<string, unknown>;
    const responseFormat = gen.responseFormat as Record<string, unknown>;
    expect((responseFormat.image as Record<string, unknown>).imageSize).toBe("1K");
  });

  it("upgrades '0.5k' → '1K' for nano-banana-pro (Pro doesn't support 512)", () => {
    expect(imageSizeFor("0.5k", "nano-banana-pro")).toBe("1K");
  });
});

// ─── Cost calculation (Spec 64.6b: resolution-aware) ──────────────────────────

describe("nanoBananaImageCostEur (Spec 64.6b)", () => {
  it("returns correct EUR for nano-banana-2 across all resolutions", () => {
    // $ × 0.92 EUR/USD
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "0.5k", count: 1 }))
      .toBeCloseTo(0.0414, 3); // 0.045 × 0.92
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "1k", count: 1 }))
      .toBeCloseTo(0.0616, 3); // 0.067 × 0.92
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "2k", count: 1 }))
      .toBeCloseTo(0.0929, 3); // 0.101 × 0.92
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "4k", count: 1 }))
      .toBeCloseTo(0.1389, 3); // 0.151 × 0.92
  });

  it("returns correct EUR for nano-banana-pro across all resolutions", () => {
    expect(nanoBananaImageCostEur({ model: "nano-banana-pro", resolution: "1k", count: 1 }))
      .toBeCloseTo(0.1233, 3); // 0.134 × 0.92
    expect(nanoBananaImageCostEur({ model: "nano-banana-pro", resolution: "2k", count: 1 }))
      .toBeCloseTo(0.1233, 3);
    expect(nanoBananaImageCostEur({ model: "nano-banana-pro", resolution: "4k", count: 1 }))
      .toBeCloseTo(0.2208, 3); // 0.240 × 0.92
  });

  it("scales linearly with count", () => {
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "1k", count: 5 }))
      .toBeCloseTo(0.308, 2); // 0.067 × 5 × 0.92 = 0.3082
  });
});

// ─── extractInlineImage ───────────────────────────────────────────────────────

describe("extractInlineImage", () => {
  it("decodes base64 inlineData into bytes + mime + seed", () => {
    const helloBase64 = Buffer.from("hello").toString("base64");
    const resp: GeminiResponse = {
      candidates: [
        {
          content: { parts: [{ inlineData: { mimeType: "image/webp", data: helloBase64 } }] },
          seed: 99,
        },
      ],
    };
    const result = extractInlineImage(resp);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/webp");
    expect(result!.seed).toBe(99);
    expect(Buffer.from(result!.bytes).toString("utf8")).toBe("hello");
  });

  it("returns null when no inlineData part is present", () => {
    expect(extractInlineImage({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }))
      .toBeNull();
    expect(extractInlineImage({})).toBeNull();
  });

  it("returns seed=null when Gemini omits it (random gen)", () => {
    const data = Buffer.from("img").toString("base64");
    const result = extractInlineImage({
      candidates: [{ content: { parts: [{ inlineData: { data } }] } }],
    });
    expect(result!.seed).toBeNull();
  });
});

// ─── callGeminiWithRetry — 5xx + 4xx (Spec 64.6 unchanged) ───────────────────

describe("callGeminiWithRetry", () => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_BANANA_MODELS["nano-banana-2"]}:generateContent`;
  const body = { contents: [{ parts: [{ text: "x" }] }] };

  it("sends POST with x-goog-api-key header and JSON body", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { data: "AA==" } }] } }] } },
    ]);

    await callGeminiWithRetry(url, "test-api-key", body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe(url);
    const opts = call[1] as RequestInit;
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-api-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(opts.body as string)).toEqual(body);
  });

  it("retries on 5xx and resolves on eventual 200", async () => {
    const successBody = { candidates: [{ content: { parts: [{ inlineData: { data: "AA==" } }] } }] };
    const { fetchMock } = mockFetchResponses([
      { status: 503, body: { error: { message: "overloaded" } } },
      { status: 503, body: { error: { message: "overloaded" } } },
      { status: 200, body: successBody },
    ]);

    const result = await callGeminiWithRetry(url, "k", body);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.response).toEqual(successBody);
  });

  it("throws NanoBananaGenerationError after 3 failed 5xx attempts", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 500, body: "oops" },
      { status: 500, body: "oops" },
      { status: 500, body: "oops" },
    ]);

    await expect(callGeminiWithRetry(url, "k", body)).rejects.toThrow(NanoBananaGenerationError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails fast on 4xx without retrying", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 400, body: { error: { message: "invalid prompt" } } },
    ]);

    await expect(callGeminiWithRetry(url, "k", body)).rejects.toThrow(/Gemini 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces Gemini-side error payload from a 200 response", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 200, body: { error: { message: "content blocked", code: 9 } } },
    ]);

    await expect(callGeminiWithRetry(url, "k", body)).rejects.toThrow(/content blocked/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── callGeminiWithRetry — 429 rate-limit handling (Spec 64.6b) ──────────────

describe("callGeminiWithRetry — 429 rate-limit handling (Spec 64.6b)", () => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_BANANA_MODELS["nano-banana-2"]}:generateContent`;
  const body = { contents: [{ parts: [{ text: "x" }] }] };

  it("retries on 429 and resolves on eventual 200", async () => {
    const successBody = { candidates: [{ content: { parts: [{ inlineData: { data: "AA==" } }] } }] };
    const { fetchMock } = mockFetchResponses([
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 200, body: successBody },
    ]);

    const start = Date.now();
    const result = await callGeminiWithRetry(url, "k", body);
    const elapsed = Date.now() - start;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.response).toEqual(successBody);
    // 429 backoff is 1s + 2s = 3000ms minimum between 3 attempts.
    // Allow a small jitter floor (>= 2800ms) to dodge clock-resolution flake.
    expect(elapsed).toBeGreaterThanOrEqual(2800);
  });

  it("throws \"Rate limited after 3 attempts\" after 3 failed 429s", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 429, body: { error: { message: "rate limit" } } },
    ]);

    await expect(callGeminiWithRetry(url, "k", body)).rejects.toThrow(/Rate limited after 3 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("429 backoff is longer than 5xx backoff (cycle-time comparison)", async () => {
    // Two cycles of two retries each — 429 should take ~3s (1s+2s), 5xx ~1.5s (500ms+1s).
    const { fetchMock: fm429 } = mockFetchResponses([
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} },
    ]);
    const t429Start = Date.now();
    await callGeminiWithRetry(url, "k", body).catch(() => undefined);
    const t429 = Date.now() - t429Start;
    expect(fm429).toHaveBeenCalledTimes(3);

    const { fetchMock: fm5xx } = mockFetchResponses([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    const t5xxStart = Date.now();
    await callGeminiWithRetry(url, "k", body).catch(() => undefined);
    const t5xx = Date.now() - t5xxStart;
    expect(fm5xx).toHaveBeenCalledTimes(3);

    // 429: 1s + 2s = 3s. 5xx: 500ms + 1s = 1.5s. Expect a clear gap.
    expect(t429).toBeGreaterThan(t5xx + 800);
  });
});

// ─── Public surface ───────────────────────────────────────────────────────────

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.generateImage).toBe("function");
    expect(typeof mod.nanoBanana.generateImage).toBe("function");
    expect(mod.NANO_BANANA_MODELS["nano-banana-2"]).toBe("gemini-3-flash-image-preview");
    expect(mod.NANO_BANANA_MODELS["nano-banana-pro"]).toBe("gemini-3-pro-image-preview");
  });
});
