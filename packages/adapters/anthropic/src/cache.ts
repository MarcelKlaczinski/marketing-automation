import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, getEnv } from "@marketing-auto/shared";
import type { CacheMode, CachedResponse } from "./cache-types.ts";
import type { MessagesInput, MessagesResult } from "./types.ts";

const log = createLogger("anthropic:cache");

/** Where fixtures live — under the package root, committed to git */
const FIXTURES_DIR = (() => {
  // import.meta.dirname resolves to the directory of this file (src/)
  // join(.., "fixtures") → packages/adapters/anthropic/fixtures/
  const here = import.meta.dirname;
  return join(here, "..", "fixtures");
})();

/** Resolve cache mode from env, falling back to "off". */
export function getCacheMode(): CacheMode {
  const raw = getEnv().ANTHROPIC_CACHE_MODE ?? "off";
  return raw;
}

/**
 * Compute deterministic cache key from MessagesInput.
 *
 * Includes only fields that affect the LLM output. Excludes run-correlation
 * IDs (pipelineRunId, articleId, projectId) and tracking metadata
 * (operation, estimatedCostEur). WebSearch is excluded — those calls are
 * never cached anyway (see isCacheable).
 *
 * Returns first 16 hex chars of sha256 → collision probability ~1e-15 for
 * any realistic fixture-set size.
 */
export function computeCacheKey(input: MessagesInput): string {
  const canonical = {
    model: input.model,
    systemPrefix: input.systemPrefix,
    systemSuffix: input.systemSuffix,
    userMessage: input.userMessage,
    maxTokens: input.maxTokens ?? null,
    temperature: input.temperature ?? null,
    topP: input.topP ?? null,
    topK: input.topK ?? null,
    jsonMode: input.jsonMode ?? false,
    cacheTtl: input.cacheTtl ?? null,
  };
  const canonicalJson = JSON.stringify(canonical);
  return createHash("sha256").update(canonicalJson).digest("hex").slice(0, 16);
}

/** Path on disk for a given cache key. */
export function fixturePath(cacheKey: string): string {
  return join(FIXTURES_DIR, `${cacheKey}.json`);
}

/** Whether a call is eligible for caching. WebSearch calls are never cached (stale results). */
export function isCacheable(input: MessagesInput): boolean {
  return !(input.webSearch?.enabled === true);
}

/**
 * Read a fixture from disk. Returns null if missing.
 * Throws if file exists but is malformed JSON; logs and returns null.
 */
export function readFixture(cacheKey: string): CachedResponse | null {
  const path = fixturePath(cacheKey);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as CachedResponse;
    if (parsed.schemaVersion !== 1) {
      log.warn(
        { cacheKey, version: parsed.schemaVersion },
        "Fixture has unexpected schema version — treating as miss"
      );
      return null;
    }
    return parsed;
  } catch (e) {
    log.error({ cacheKey, err: e }, "Failed to parse fixture — treating as miss");
    return null;
  }
}

/** Write a fixture to disk, creating the fixtures directory if needed. */
export function writeFixture(
  cacheKey: string,
  input: MessagesInput,
  response: MessagesResult
): void {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  const fixture: CachedResponse = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    metadata: {
      model: input.model,
      systemPrefixLen: input.systemPrefix.length,
      systemSuffixLen: input.systemSuffix.length,
      userMessageLen: input.userMessage.length,
      jsonMode: input.jsonMode ?? false,
      operation: input.operation,
      userMessagePreview: input.userMessage.slice(0, 80),
    },
    // Zero out Anthropic's prompt-cache stats — not meaningful for fixture replays
    response: {
      ...response,
      cacheStats: {
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalInputTokens: 0,
        freshInputTokens: 0,
        hit: false,
      },
    },
  };

  writeFileSync(fixturePath(cacheKey), JSON.stringify(fixture, null, 2), "utf-8");
  log.debug({ cacheKey, operation: input.operation }, "Recorded fixture");
}

/** List all fixture files (for the CLI). */
export function listFixtures(): Array<{ cacheKey: string; fixture: CachedResponse }> {
  if (!existsSync(FIXTURES_DIR)) return [];
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  const out: Array<{ cacheKey: string; fixture: CachedResponse }> = [];
  for (const f of files) {
    const cacheKey = f.replace(/\.json$/, "");
    const fixture = readFixture(cacheKey);
    if (fixture) out.push({ cacheKey, fixture });
  }
  return out;
}
