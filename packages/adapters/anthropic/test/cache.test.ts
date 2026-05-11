import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import {
  computeCacheKey,
  fixturePath,
  isCacheable,
  readFixture,
  writeFixture,
} from "../src/cache.ts";
import type { MessagesInput, MessagesResult } from "../src/types.ts";

const baseInput: MessagesInput = {
  projectId: "00000000-0000-0000-0000-000000000001",
  operation: "test",
  model: "claude-sonnet-4-6",
  systemPrefix: "You are helpful.",
  systemSuffix: "Be concise.",
  userMessage: "What is 2+2?",
  jsonMode: false,
  estimatedCostEur: 0.01,
};

const baseResult: MessagesResult = {
  raw: "4",
  json: null,
  outputTokens: 1,
  cacheStats: {
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalInputTokens: 5,
    freshInputTokens: 5,
    hit: false,
  },
  stopReason: "end_turn",
  messageId: "msg_test",
};

const testKeysToCleanup: string[] = [];

afterEach(() => {
  for (const k of testKeysToCleanup) {
    const p = fixturePath(k);
    if (existsSync(p)) rmSync(p);
  }
  testKeysToCleanup.length = 0;
});

describe("cache key", () => {
  test("same input → same key (deterministic)", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput });
    expect(k1).toBe(k2);
  });

  test("key is 16 hex characters", () => {
    const k = computeCacheKey(baseInput);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });

  test("different userMessage → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, userMessage: "What is 3+3?" });
    expect(k1).not.toBe(k2);
  });

  test("different projectId → SAME key (excluded from key)", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({
      ...baseInput,
      projectId: "00000000-0000-0000-0000-000000000099",
    });
    expect(k1).toBe(k2);
  });

  test("different pipelineRunId → SAME key (excluded)", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, pipelineRunId: "abc-123" });
    expect(k1).toBe(k2);
  });

  test("different articleId → SAME key (excluded)", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, articleId: "article-xyz" });
    expect(k1).toBe(k2);
  });

  test("different operation → SAME key (excluded — tracking only)", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, operation: "different-op" });
    expect(k1).toBe(k2);
  });

  test("different model → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, model: "claude-haiku-4-5" });
    expect(k1).not.toBe(k2);
  });

  test("different systemPrefix → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, systemPrefix: "Different prefix" });
    expect(k1).not.toBe(k2);
  });

  test("different systemSuffix → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, systemSuffix: "Different suffix" });
    expect(k1).not.toBe(k2);
  });

  test("jsonMode change → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, jsonMode: true });
    expect(k1).not.toBe(k2);
  });

  test("maxTokens change → different key", () => {
    const k1 = computeCacheKey(baseInput);
    const k2 = computeCacheKey({ ...baseInput, maxTokens: 2048 });
    expect(k1).not.toBe(k2);
  });
});

describe("isCacheable", () => {
  test("normal input is cacheable", () => {
    expect(isCacheable(baseInput)).toBe(true);
  });

  test("webSearch enabled → not cacheable", () => {
    expect(
      isCacheable({
        ...baseInput,
        webSearch: { enabled: true, maxUses: 3 },
      })
    ).toBe(false);
  });

  test("webSearch disabled → cacheable", () => {
    expect(isCacheable({ ...baseInput, webSearch: { enabled: false } })).toBe(true);
  });
});

describe("fixture roundtrip", () => {
  test("write then read returns equivalent response", () => {
    const cacheKey = computeCacheKey(baseInput);
    testKeysToCleanup.push(cacheKey);

    writeFixture(cacheKey, baseInput, baseResult);
    expect(existsSync(fixturePath(cacheKey))).toBe(true);

    const fixture = readFixture(cacheKey);
    expect(fixture).not.toBeNull();
    expect(fixture!.response.raw).toBe(baseResult.raw);
    expect(fixture!.response.outputTokens).toBe(baseResult.outputTokens);
    expect(fixture!.metadata.model).toBe(baseInput.model);
    expect(fixture!.metadata.operation).toBe(baseInput.operation);
    expect(fixture!.schemaVersion).toBe(1);
    expect(fixture!.recordedAt).toBeTruthy();
  });

  test("fixture response has zeroed cacheStats (Anthropic prompt cache not relevant for replays)", () => {
    const cacheKey = computeCacheKey({ ...baseInput, userMessage: "cacheStats-test" });
    testKeysToCleanup.push(cacheKey);

    const resultWithCacheHit: MessagesResult = {
      ...baseResult,
      cacheStats: { cacheReadInputTokens: 100, cacheCreationInputTokens: 0, totalInputTokens: 100, freshInputTokens: 0, hit: true },
    };
    writeFixture(cacheKey, { ...baseInput, userMessage: "cacheStats-test" }, resultWithCacheHit);

    const fixture = readFixture(cacheKey);
    expect(fixture!.response.cacheStats.cacheReadInputTokens).toBe(0);
    expect(fixture!.response.cacheStats.hit).toBe(false);
  });

  test("readFixture returns null for missing key", () => {
    expect(readFixture("nonexistent_key_xyz")).toBeNull();
  });

  test("readFixture with malformed JSON returns null", () => {
    const cacheKey = "malformed_test_key1";
    testKeysToCleanup.push(cacheKey);
    writeFileSync(fixturePath(cacheKey), "not valid json", "utf-8");
    expect(readFixture(cacheKey)).toBeNull();
  });

  test("readFixture with wrong schemaVersion returns null", () => {
    const cacheKey = "wrong_schema_key1";
    testKeysToCleanup.push(cacheKey);
    writeFileSync(
      fixturePath(cacheKey),
      JSON.stringify({ schemaVersion: 99, recordedAt: "", metadata: {}, response: {} }),
      "utf-8"
    );
    expect(readFixture(cacheKey)).toBeNull();
  });

  test("userMessagePreview is truncated to 80 chars", () => {
    const longMsg = "A".repeat(200);
    const input = { ...baseInput, userMessage: longMsg };
    const cacheKey = computeCacheKey(input);
    testKeysToCleanup.push(cacheKey);

    writeFixture(cacheKey, input, baseResult);
    const fixture = readFixture(cacheKey);
    expect(fixture!.metadata.userMessagePreview.length).toBe(80);
  });
});
