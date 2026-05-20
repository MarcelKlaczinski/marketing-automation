import { getGoldenPrompt } from "@marketing-auto/db";

/**
 * Spec 62.0b Section 4.2: in-process cache for `prompt_versions.is_golden = true` lookups.
 *
 * Why this exists: `resolvePrompt()` is called on EVERY LLM step execution. Hitting the DB
 * each time would add 30-50ms of latency per call and a couple thousand reads per pipeline
 * batch. With a 5-minute TTL and explicit invalidation on every promote, the cache stays
 * accurate while reducing DB load to one read per (step, project) per cache window.
 *
 * Negative-cache: a "no golden" result is cached under the same TTL so a step without a
 * promoted golden doesn't ping the DB on every execution either. Represented by `null`
 * in the entry; `cache.has(key)` distinguishes "miss" from "negative-hit".
 *
 * Single-process caveat: in a multi-worker deployment each process maintains its own
 * cache and a promote on worker A does not invalidate worker B. Acceptable for the
 * current single-instance Toolwiki deployment; future migration to Redis pub-sub is
 * additive (this module's public API stays stable).
 */
type CacheKey = string; // `${stepName}::${projectId ?? "GLOBAL"}`
type CacheEntry = { body: string | null; cachedAt: number };

const cache = new Map<CacheKey, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function makeKey(stepName: string, projectId: string | null): CacheKey {
  return `${stepName}::${projectId ?? "GLOBAL"}`;
}

/**
 * Read a golden prompt with TTL caching. Returns `{ body }` when a golden exists or
 * `null` when none is set. The caller (resolvePrompt) discriminates and falls through
 * to the next resolver tier on `null`.
 */
export async function getGoldenPromptCached(input: {
  stepName: string;
  projectId: string | null;
}): Promise<{ body: string } | null> {
  const key = makeKey(input.stepName, input.projectId);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.body === null ? null : { body: cached.body };
  }

  const row = await getGoldenPrompt({ stepName: input.stepName, projectId: input.projectId });
  cache.set(key, { body: row?.body ?? null, cachedAt: Date.now() });
  return row ? { body: row.body } : null;
}

/**
 * Invalidate a single (step, project) entry. Called inline from promoteToGolden after
 * the transaction commits — the next resolvePrompt() call will re-read from DB.
 */
export function invalidateGoldenPromptCache(input: {
  stepName: string;
  projectId: string | null;
}): void {
  cache.delete(makeKey(input.stepName, input.projectId));
}

/**
 * Drop every entry. Test-only helper — production code uses the targeted invalidator.
 */
export function clearGoldenPromptCacheForTesting(): void {
  cache.clear();
}
