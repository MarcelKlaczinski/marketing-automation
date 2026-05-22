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

// ─── Request body shape ───────────────────────────────────────────────────────

describe("buildModelRequestBody", () => {
  it("includes prompt + aspectRatio + outputMimeType + seed", () => {
    const body = buildModelRequestBody({
      projectId: "p1",
      operation: "hero-image-generation",
      model: "nano-banana-2",
      prompt: "Editorial flatlay",
      aspectRatio: "16:9",
      outputFormat: "webp",
      seed: 42,
      storagePrefix: "toolwiki/articles/hero",
      estimatedCostEur: 0.1,
    });

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Editorial flatlay" }] },
    ]);

    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.candidateCount).toBe(1);
    expect(gen.seed).toBe(42);

    const imageConfig = gen.imageConfig as Record<string, unknown>;
    expect(imageConfig.aspectRatio).toBe("16:9");
    expect(imageConfig.outputMimeType).toBe("image/webp");
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

// ─── Cost calculation ─────────────────────────────────────────────────────────

describe("nanoBananaImageCostEur", () => {
  it("returns ~€0.062 for nano-banana-2 at 2K", () => {
    // $0.067 × 0.92 EUR/USD = 0.06164
    expect(nanoBananaImageCostEur({ model: "nano-banana-2", count: 1 })).toBeCloseTo(0.062, 2);
  });

  it("returns ~€0.123 for nano-banana-pro at 2K", () => {
    // $0.134 × 0.92 EUR/USD = 0.12328
    expect(nanoBananaImageCostEur({ model: "nano-banana-pro", count: 1 })).toBeCloseTo(0.123, 2);
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

// ─── callGeminiWithRetry ──────────────────────────────────────────────────────

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
