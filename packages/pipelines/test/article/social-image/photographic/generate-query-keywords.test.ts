/**
 * Spec 65.8 — generate-query-keywords unit tests.
 *
 * Mocks `@marketing-auto/adapter-anthropic` to stay offline (Haiku call).
 * Covers happy path, Zod-fail fallback, throw fallback, empty-variables
 * defensive path. Tests the pure builders (`buildQueryKeywordsUserMessage`,
 * `buildFallbackQueries`) directly without mocking.
 *
 * IMPORTANT: uses `mock.module()` which is process-global — keep per-package
 * CI isolation (run via `bun --filter @marketing-auto/pipelines test`).
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

let messagesImpl: (() => Promise<{ raw: string; json: unknown }>) | null = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async () => {
      if (!messagesImpl) throw new Error("messagesImpl not set in test");
      const r = await messagesImpl();
      return {
        raw: r.raw,
        json: r.json,
        outputTokens: 30,
        cacheStats: {
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalInputTokens: 100,
          freshInputTokens: 100,
          hit: false,
        },
        stopReason: "end_turn",
        messageId: "msg-test",
      };
    },
  },
}));

import {
  buildFallbackQueries,
  buildQueryKeywordsUserMessage,
  generateImageQueryKeywords,
  type GenerateImageQueryKeywordsInput,
} from "../../../../src/article/social-image/photographic/generate-query-keywords.ts";

const BASE_INPUT: GenerateImageQueryKeywordsInput = {
  hookContext: {
    rendered: "Wie ich als Texter meinen Job mit KI rettete",
    variables: { profession: "Texter", lifeArea: "Job" },
  },
  narrativeBeat: "conflict",
  beatText:
    "Plötzlich konnte ich die ChatGPT-generierten Texte nicht mehr von meinen unterscheiden. Mein USP fiel weg.",
  formatType: "story_arc_clickbait",
  projectId: "00000000-0000-0000-0000-000000000abc",
};

beforeEach(() => {
  messagesImpl = null;
});

describe("buildQueryKeywordsUserMessage", () => {
  it("injects hook + beat + variables into the prompt", () => {
    const msg = buildQueryKeywordsUserMessage(BASE_INPUT);
    expect(msg).toContain("Wie ich als Texter meinen Job mit KI rettete");
    expect(msg).toContain("profession: Texter");
    expect(msg).toContain("lifeArea: Job");
    expect(msg).toContain("conflict");
    expect(msg).toContain("story_arc_clickbait");
  });

  it("uses a generic tone when narrativeBeat is unknown", () => {
    const msg = buildQueryKeywordsUserMessage({
      ...BASE_INPUT,
      narrativeBeat: "unknown-beat-name",
    });
    expect(msg).toContain("general emotional match");
  });

  it("handles empty hook variables gracefully", () => {
    const msg = buildQueryKeywordsUserMessage({
      ...BASE_INPUT,
      hookContext: { rendered: "Hook", variables: {} },
    });
    expect(msg).toContain("(none)");
  });
});

describe("buildFallbackQueries", () => {
  it("derives 3 queries from profession + beat", () => {
    const queries = buildFallbackQueries(BASE_INPUT);
    expect(queries.length).toBe(3);
    expect(queries[0]?.toLowerCase()).toContain("texter");
  });

  it("falls back to lifeArea when profession is absent", () => {
    const queries = buildFallbackQueries({
      ...BASE_INPUT,
      hookContext: { rendered: "x", variables: { lifeArea: "Familie" } },
    });
    expect(queries[0]?.toLowerCase()).toContain("familie");
  });

  it("uses a generic subject when both profession and lifeArea are absent", () => {
    const queries = buildFallbackQueries({
      ...BASE_INPUT,
      hookContext: { rendered: "x", variables: {} },
    });
    expect(queries.length).toBe(3);
    queries.forEach((q) => {
      expect(q.length).toBeGreaterThan(0);
      expect(q.length).toBeLessThanOrEqual(60);
    });
  });
});

describe("generateImageQueryKeywords", () => {
  it("returns LLM-sourced queries on happy path", async () => {
    messagesImpl = async () => ({
      raw: "n/a",
      json: ["frustrated copywriter at desk", "writer staring at screen", "burned-out professional"],
    });
    const result = await generateImageQueryKeywords(BASE_INPUT);
    expect(result.source).toBe("llm");
    expect(result.queries.length).toBe(3);
    expect(result.queries[0]).toBe("frustrated copywriter at desk");
  });

  it("falls back when Zod parse fails (wrong shape)", async () => {
    messagesImpl = async () => ({ raw: "n/a", json: { not: "an array" } });
    const result = await generateImageQueryKeywords(BASE_INPUT);
    expect(result.source).toBe("fallback");
    expect(result.queries.length).toBe(3);
  });

  it("falls back when Zod array is too short", async () => {
    messagesImpl = async () => ({ raw: "n/a", json: ["only one"] });
    const result = await generateImageQueryKeywords(BASE_INPUT);
    expect(result.source).toBe("fallback");
  });

  it("falls back when the LLM call throws", async () => {
    messagesImpl = async () => {
      throw new Error("rate-limited");
    };
    const result = await generateImageQueryKeywords(BASE_INPUT);
    expect(result.source).toBe("fallback");
    expect(result.queries.length).toBe(3);
  });

  it("falls back when an array entry is too short", async () => {
    messagesImpl = async () => ({
      raw: "n/a",
      json: ["x", "valid query", "another valid query"], // first item under min length 3
    });
    const result = await generateImageQueryKeywords(BASE_INPUT);
    expect(result.source).toBe("fallback");
  });
});
