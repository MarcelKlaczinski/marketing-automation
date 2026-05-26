/**
 * Spec 65.8 — pick-image-llm unit tests.
 *
 * Mocks `@marketing-auto/adapter-anthropic` (Sonnet vision). Sonnet rejects
 * assistant prefill so the adapter does NOT pre-pend `{` — `result.raw`
 * must contain the full JSON object (often wrapped in prose). We assert the
 * extract-from-raw branch handles preamble + fenced JSON + trailing prose.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

let messagesImpl: (() => Promise<{ raw: string; json: unknown }>) | null = null;
let lastCallInput: unknown = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async (input: unknown) => {
      lastCallInput = input;
      if (!messagesImpl) throw new Error("messagesImpl not set in test");
      const r = await messagesImpl();
      return {
        raw: r.raw,
        json: r.json,
        outputTokens: 50,
        cacheStats: {
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalInputTokens: 5000,
          freshInputTokens: 5000,
          hit: false,
        },
        stopReason: "end_turn",
        messageId: "msg-test",
      };
    },
  },
}));

import {
  buildPickImageUserMessage,
  extractJsonFromRaw,
  pickBestImage,
  type PickableCandidate,
} from "../../../../src/article/social-image/photographic/pick-image-llm.ts";

function candidate(provider: "pexels" | "unsplash" | "pixabay", idx: number): PickableCandidate {
  return {
    provider,
    providerId: `${provider}-${idx}`,
    thumbnailUrl: `https://cdn.${provider}.test/thumb-${idx}.jpg`,
  };
}

const BASE = {
  projectId: "00000000-0000-0000-0000-000000000abc",
  beatText: "The moment I realised AI could write better than me.",
  hookRendered: "How I saved my career as a copywriter with AI",
  theme: "dark" as const,
  brandPrimaryColor: "#7B61FF",
};

beforeEach(() => {
  messagesImpl = null;
  lastCallInput = null;
});

describe("extractJsonFromRaw", () => {
  it("parses a bare JSON object", () => {
    const obj = extractJsonFromRaw('{"selectedIndex":2,"reasoning":"good fit"}');
    expect(obj).toEqual({ selectedIndex: 2, reasoning: "good fit" });
  });

  it("strips preamble before the opening brace", () => {
    const obj = extractJsonFromRaw(
      'Here is my pick:\n{"selectedIndex":1,"reasoning":"first one"}',
    );
    expect((obj as { selectedIndex: number }).selectedIndex).toBe(1);
  });

  it("strips trailing prose after the closing brace", () => {
    const obj = extractJsonFromRaw(
      '{"selectedIndex":3,"reasoning":"vibes"}\n\nNote: this is final.',
    );
    expect((obj as { selectedIndex: number }).selectedIndex).toBe(3);
  });

  it("throws on no braces at all", () => {
    expect(() => extractJsonFromRaw("no JSON here")).toThrow(/no JSON/i);
  });
});

describe("buildPickImageUserMessage", () => {
  it("numbers candidates 1..N with their provider + id", () => {
    const msg = buildPickImageUserMessage(
      [candidate("pexels", 1), candidate("unsplash", 2)],
      BASE.beatText,
      BASE.hookRendered,
      BASE.theme,
      BASE.brandPrimaryColor,
    );
    expect(msg).toContain("Image 1: provider=pexels");
    expect(msg).toContain("Image 2: provider=unsplash");
    expect(msg).toContain("Pick the single best image (1 to 2)");
  });

  it("includes theme-specific hint for dark", () => {
    const msg = buildPickImageUserMessage(
      [candidate("pexels", 1)],
      BASE.beatText,
      BASE.hookRendered,
      "dark",
      BASE.brandPrimaryColor,
    );
    expect(msg).toContain("darker images");
  });

  it("includes theme-specific hint for light", () => {
    const msg = buildPickImageUserMessage(
      [candidate("pexels", 1)],
      BASE.beatText,
      BASE.hookRendered,
      "light",
      BASE.brandPrimaryColor,
    );
    expect(msg).toContain("brighter images");
  });
});

describe("pickBestImage", () => {
  it("returns the LLM-picked candidate on happy path", async () => {
    messagesImpl = async () => ({
      raw: '{"selectedIndex":2,"reasoning":"emotional fit, clear subject"}',
      json: null,
    });
    const candidates = [candidate("pexels", 1), candidate("unsplash", 2), candidate("pixabay", 3)];
    const result = await pickBestImage({ ...BASE, candidates });
    expect(result.source).toBe("llm");
    expect(result.picked.providerId).toBe("unsplash-2");
    expect(result.reasoning).toContain("emotional fit");
  });

  it("attaches all candidate thumbnails as image-content blocks", async () => {
    messagesImpl = async () => ({ raw: '{"selectedIndex":1,"reasoning":"x"}', json: null });
    const candidates = [candidate("pexels", 1), candidate("unsplash", 2)];
    await pickBestImage({ ...BASE, candidates });
    expect(lastCallInput).toBeDefined();
    const call = lastCallInput as { userImages?: Array<{ type: string; url: string }> };
    expect(call.userImages?.length).toBe(2);
    expect(call.userImages?.[0]?.type).toBe("url");
    expect(call.userImages?.[0]?.url).toContain("pexels");
  });

  it("does NOT pass jsonMode (Sonnet 4.6 rejects assistant prefill)", async () => {
    messagesImpl = async () => ({ raw: '{"selectedIndex":1,"reasoning":"x"}', json: null });
    await pickBestImage({ ...BASE, candidates: [candidate("pexels", 1)] });
    const call = lastCallInput as { jsonMode?: boolean };
    expect(call.jsonMode).toBeUndefined();
  });

  it("falls back to candidates[0] when the JSON parse fails", async () => {
    messagesImpl = async () => ({ raw: "not even close to JSON", json: null });
    const candidates = [candidate("pexels", 1), candidate("unsplash", 2)];
    const result = await pickBestImage({ ...BASE, candidates });
    expect(result.source).toBe("fallback");
    expect(result.picked.providerId).toBe("pexels-1");
  });

  it("falls back when the LLM picks an out-of-range index", async () => {
    messagesImpl = async () => ({ raw: '{"selectedIndex":99,"reasoning":"x"}', json: null });
    const candidates = [candidate("pexels", 1), candidate("unsplash", 2)];
    const result = await pickBestImage({ ...BASE, candidates });
    expect(result.source).toBe("fallback");
    expect(result.picked.providerId).toBe("pexels-1");
  });

  it("falls back when the LLM call throws", async () => {
    messagesImpl = async () => {
      throw new Error("rate-limited");
    };
    const candidates = [candidate("pexels", 1)];
    const result = await pickBestImage({ ...BASE, candidates });
    expect(result.source).toBe("fallback");
    expect(result.picked.providerId).toBe("pexels-1");
  });

  it("caps the LLM input at 10 candidates", async () => {
    messagesImpl = async () => ({ raw: '{"selectedIndex":1,"reasoning":"x"}', json: null });
    const candidates: PickableCandidate[] = Array.from({ length: 15 }, (_, i) =>
      candidate("pexels", i + 1),
    );
    await pickBestImage({ ...BASE, candidates });
    const call = lastCallInput as { userImages?: Array<unknown> };
    expect(call.userImages?.length).toBe(10);
  });

  it("throws when candidates is empty (caller must guard)", async () => {
    await expect(pickBestImage({ ...BASE, candidates: [] })).rejects.toThrow(/empty candidates/);
  });
});
