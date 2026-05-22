// Spec 64.7: Nano-Banana batch adapter tests.
//
// All tests stay offline:
//   - fetch is replaced with a mock returning canned JSON bodies
//   - R2 putObject is replaced via mock.module() to avoid hitting real storage
//   - getGlobal credentials are replaced with a vault stub that returns a fake key
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const ORIGINAL_FETCH = globalThis.fetch;
type FetchFn = typeof globalThis.fetch;

// ─── Module mocks (set before importing the adapter) ──────────────────────────

mock.module("@marketing-auto/core/credentials", () => ({
  getGlobal: mock(async () => "test-api-key"),
}));

mock.module("@marketing-auto/adapter-storage", () => ({
  putObject: mock(async (input: { key: string; body: Uint8Array }) => ({
    key: input.key,
    publicUrl: `https://cdn.test/${input.key}`,
    bytesStored: input.body.byteLength,
    contentType: "image/webp",
  })),
}));

const {
  createImageBatch,
  retrieveBatch,
  fetchBatchResults,
  parseAndStoreInlinedResponses,
  classifyState,
  NanoBananaGenerationError,
} = await import("../src/index.ts");
const { nanoBananaImageCostEur } = await import("@marketing-auto/cost-tracker");

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

beforeEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// 1×1 webp inline payload — minimal valid bytes for upload roundtrip.
// (Doesn't need to be a real decodable webp — we don't decode in the adapter,
// only base64-decode + forward to R2.)
const TINY_WEBP_B64 = Buffer.from("FAKE_WEBP_BYTES").toString("base64");

// ─── createImageBatch ─────────────────────────────────────────────────────────

describe("createImageBatch", () => {
  it("submits batch with metadata.key + nested input_config + returns batchName", async () => {
    const { fetchMock } = mockFetchResponses([
      { status: 200, body: { name: "batches/123456" } },
    ]);

    const result = await createImageBatch({
      model: "nano-banana-2",
      displayName: "toolwiki-plan-xyz",
      requests: [
        {
          customId: "img-run-1",
          prompt: "Sunset over the Alps",
          resolution: "1k",
          aspectRatio: "16:9",
          seed: 42,
          outputFormat: "webp",
          storagePrefix: "toolwiki/articles/hero",
        },
        {
          customId: "img-run-2",
          prompt: "Espresso flatlay",
          resolution: "1k",
          aspectRatio: "16:9",
          seed: 7,
          outputFormat: "webp",
          storagePrefix: "toolwiki/articles/hero",
        },
      ],
    });

    expect(result.batchName).toBe("batches/123456");
    expect(result.requestCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-image-preview:batchGenerateContent",
    );
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-api-key");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const batch = body.batch as Record<string, unknown>;
    expect(batch.display_name).toBe("toolwiki-plan-xyz");
    const inputConfig = batch.input_config as Record<string, unknown>;
    const reqsOuter = inputConfig.requests as Record<string, unknown>;
    const innerReqs = reqsOuter.requests as Array<Record<string, unknown>>;
    expect(innerReqs).toHaveLength(2);

    const first = innerReqs[0]!;
    expect((first.metadata as Record<string, unknown>).key).toBe("img-run-1");
    const request = first.request as Record<string, unknown>;
    const gen = request.generationConfig as Record<string, unknown>;
    expect(gen.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(gen.seed).toBe(42);
    const responseFormat = gen.responseFormat as Record<string, unknown>;
    const image = responseFormat.image as Record<string, unknown>;
    expect(image.imageSize).toBe("1K"); // uppercase per Gemini docs
    expect(image.aspectRatio).toBe("16:9");
  });

  it("throws on empty request array (caller bug, not API call)", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);
    expect(() =>
      createImageBatch({
        model: "nano-banana-2",
        displayName: "empty",
        requests: [],
      }),
    ).toThrow(NanoBananaGenerationError);
  });

  it("throws when response is missing 'name' field", async () => {
    mockFetchResponses([{ status: 200, body: { unexpected: "shape" } }]);
    expect(
      createImageBatch({
        model: "nano-banana-2",
        displayName: "x",
        requests: [
          {
            customId: "img-1",
            prompt: "p",
            resolution: "1k",
            aspectRatio: "16:9",
            seed: 1,
            outputFormat: "webp",
            storagePrefix: "x",
          },
        ],
      }),
    ).rejects.toThrow("response missing 'name'");
  });
});

// ─── retrieveBatch ────────────────────────────────────────────────────────────

describe("retrieveBatch", () => {
  it("maps JOB_STATE_RUNNING to 'processing'", async () => {
    mockFetchResponses([{ status: 200, body: { state: "JOB_STATE_RUNNING" } }]);
    const r = await retrieveBatch("batches/abc");
    expect(r.state).toBe("processing");
    expect(r.rawState).toBe("JOB_STATE_RUNNING");
  });

  it("maps JOB_STATE_SUCCEEDED to 'succeeded'", async () => {
    mockFetchResponses([{ status: 200, body: { state: "JOB_STATE_SUCCEEDED" } }]);
    const r = await retrieveBatch("batches/abc");
    expect(r.state).toBe("succeeded");
  });

  it("maps JOB_STATE_FAILED + CANCELLED + EXPIRED all to 'failed'", () => {
    expect(classifyState("JOB_STATE_FAILED")).toBe("failed");
    expect(classifyState("JOB_STATE_CANCELLED")).toBe("failed");
    expect(classifyState("JOB_STATE_EXPIRED")).toBe("failed");
  });

  it("reads state from metadata.state as fallback shape", async () => {
    mockFetchResponses([
      { status: 200, body: { metadata: { state: "JOB_STATE_SUCCEEDED" } } },
    ]);
    const r = await retrieveBatch("batches/abc");
    expect(r.state).toBe("succeeded");
  });

  it("treats unknown state as 'processing' (defensive — keep polling)", () => {
    expect(classifyState("JOB_STATE_UNSPECIFIED")).toBe("processing");
    expect(classifyState("totally-new-state")).toBe("processing");
  });
});

// ─── parseAndStoreInlinedResponses ────────────────────────────────────────────

describe("parseAndStoreInlinedResponses", () => {
  it("uploads inline image to R2 and returns succeeded result with r2Key + publicUrl", async () => {
    const response = {
      response: {
        inlinedResponses: {
          inlinedResponses: [
            {
              metadata: { key: "img-run-1", storagePrefix: "toolwiki/articles/hero" },
              response: {
                candidates: [
                  {
                    content: {
                      parts: [
                        { inlineData: { data: TINY_WEBP_B64, mimeType: "image/webp" } },
                      ],
                    },
                    seed: 42,
                  },
                ],
              },
            },
          ],
        },
      },
    };

    const results = await parseAndStoreInlinedResponses(response);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.status).toBe("succeeded");
    if (r.status === "succeeded") {
      expect(r.customId).toBe("img-run-1");
      expect(r.r2Key).toMatch(/^toolwiki\/articles\/hero\/.+\.webp$/);
      expect(r.publicUrl).toContain("https://cdn.test/");
      expect(r.seed).toBe(42);
    }
  });

  it("returns failed result when inlined entry has error payload", async () => {
    const response = {
      inlinedResponses: [
        {
          metadata: { key: "img-blocked" },
          error: { message: "Image content blocked", code: 9 },
        },
      ],
    };
    const results = await parseAndStoreInlinedResponses(response);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.customId).toBe("img-blocked");
      expect(r.error).toContain("Image content blocked");
    }
  });

  it("skips entries missing metadata.key (defensive — log + continue)", async () => {
    const response = {
      inlinedResponses: [
        {
          // metadata.key omitted
          response: {
            candidates: [
              { content: { parts: [{ inlineData: { data: TINY_WEBP_B64 } }] } },
            ],
          },
        },
        {
          metadata: { key: "img-valid" },
          response: {
            candidates: [
              { content: { parts: [{ inlineData: { data: TINY_WEBP_B64 } }] } },
            ],
          },
        },
      ],
    };
    const results = await parseAndStoreInlinedResponses(response);
    // Only the valid entry produces a result.
    expect(results).toHaveLength(1);
    expect(results[0]!.customId).toBe("img-valid");
  });

  it("returns empty array when retrieve response has no inlinedResponses", async () => {
    const results = await parseAndStoreInlinedResponses({ state: "JOB_STATE_RUNNING" });
    expect(results).toEqual([]);
  });
});

// ─── fetchBatchResults (full retrieve + parse roundtrip) ──────────────────────

describe("fetchBatchResults", () => {
  it("calls retrieve URL with GET + extracts inlined results", async () => {
    const { fetchMock } = mockFetchResponses([
      {
        status: 200,
        body: {
          state: "JOB_STATE_SUCCEEDED",
          response: {
            inlinedResponses: [
              {
                metadata: { key: "img-run-1", storagePrefix: "p/hero" },
                response: {
                  candidates: [
                    {
                      content: {
                        parts: [{ inlineData: { data: TINY_WEBP_B64, mimeType: "image/webp" } }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    ]);

    const results = await fetchBatchResults("batches/xyz");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/batches/xyz");
    expect(init.method).toBe("GET");

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("succeeded");
  });
});

// ─── Cost-tracker mode='batch' ─────────────────────────────────────────────────

describe("nanoBananaImageCostEur mode='batch'", () => {
  it("returns 50% of sync rate for nano-banana-2 1K (Toolwiki default)", () => {
    const sync = nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "1k", count: 1 });
    const batch = nanoBananaImageCostEur({
      model: "nano-banana-2",
      resolution: "1k",
      count: 1,
      mode: "batch",
    });
    // Allow tiny floating-point delta — half exactly.
    expect(batch).toBeCloseTo(sync * 0.5, 6);
  });

  it("defaults to sync when mode is omitted (backwards compat)", () => {
    const omitted = nanoBananaImageCostEur({ model: "nano-banana-2", resolution: "1k", count: 1 });
    const sync = nanoBananaImageCostEur({
      model: "nano-banana-2",
      resolution: "1k",
      count: 1,
      mode: "sync",
    });
    expect(omitted).toBe(sync);
  });

  it("applies batch discount across all resolutions + both models", () => {
    for (const model of ["nano-banana-2", "nano-banana-pro"] as const) {
      for (const resolution of ["0.5k", "1k", "2k", "4k"] as const) {
        const sync = nanoBananaImageCostEur({ model, resolution, count: 1 });
        const batch = nanoBananaImageCostEur({ model, resolution, count: 1, mode: "batch" });
        expect(batch).toBeCloseTo(sync * 0.5, 6);
      }
    }
  });
});
