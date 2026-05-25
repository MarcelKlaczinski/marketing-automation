/**
 * Spec 64.20 follow-up A2 — GitHub Search-API discovery source.
 *
 * Returns a list of candidate `owner/repo` slugs ranked by stars descending,
 * filtered by a topic query that biases toward AI tools. The caller (worker)
 * dedupes against existing `content_source_inventory.source_identifier` rows
 * and inserts new candidates with `approved_at = NULL`.
 *
 * The query is deliberately conservative — broad enough to catch new AI
 * tooling, narrow enough that Marcel's weekly approve queue stays manageable.
 * Tune per-project via `DEFAULT_SEARCH_QUERIES` override if needed.
 */

import { searchRepositories } from "../client.ts";
import type { GitHubCredentials } from "../types.ts";

export interface DiscoveryCandidate {
  /** GitHub path `owner/repo` — keyed as content_source_inventory.source_identifier. */
  sourceIdentifier: string;
  /** Human-facing name, defaults to `repo` half of `owner/repo`. */
  displayName: string;
  /** GitHub repo description, may be null. */
  description: string | null;
  /** Stars at discovery time — drives ranking + dedup pre-filter. */
  starsCount: number;
  /** Repo's homepage URL when set, else `null`. */
  homepageUrl: string | null;
  /** Where this candidate came from — for audit + UI grouping. */
  discoverySource: "github_search" | "awesome_list";
  /** Awesome-list URL when discoverySource='awesome_list', else null. */
  awesomeListSource: string | null;
}

/**
 * Default queries balance coverage vs. noise. Each query is a separate API
 * call so we stay under the 30-req/min Search-API quota even on cold runs.
 *
 * Topic filters use the de-facto `topic:ai` / `topic:llm` / `topic:agent`
 * tagging conventions on GitHub. `stars:>500` keeps the long-tail out (sub-
 * 500-star repos rarely become Toolwiki-worthy).
 */
export const DEFAULT_SEARCH_QUERIES: readonly string[] = [
  "topic:ai topic:llm stars:>500 pushed:>2025-01-01",
  "topic:ai topic:agent stars:>500 pushed:>2025-01-01",
  "topic:llm-tools stars:>500 pushed:>2025-01-01",
  "topic:claude stars:>200 pushed:>2025-01-01",
  "topic:mcp stars:>200 pushed:>2025-01-01",
];

/**
 * Skip candidates whose repo names hint at non-tool content (course material,
 * personal notes, awesome-lists themselves, etc.). Conservative — false
 * negatives are fine, false positives waste Marcel's review time.
 */
const NEGATIVE_NAME_PATTERNS: readonly RegExp[] = [
  /^awesome-/i,
  /^learn-/i,
  /-cheatsheet$/i,
  /-handbook$/i,
  /-tutorial(s?)$/i,
  /^my-/i,
];

function repoIsLikelyTool(fullName: string, name: string): boolean {
  if (NEGATIVE_NAME_PATTERNS.some((re) => re.test(name))) return false;
  if (NEGATIVE_NAME_PATTERNS.some((re) => re.test(fullName))) return false;
  return true;
}

export interface DiscoverViaSearchInput {
  credentials: GitHubCredentials;
  /** Override the default query set per-call. */
  queries?: readonly string[];
  /** Max results per query (capped at 100 by GitHub). */
  perQuery?: number;
}

export interface DiscoverViaSearchResult {
  candidates: DiscoveryCandidate[];
  /** Number of (query × result) pairs evaluated before dedup. */
  rawCount: number;
  /** Queries that errored out — empty when all succeeded. */
  failedQueries: Array<{ query: string; error: string }>;
}

export async function discoverViaSearch(
  input: DiscoverViaSearchInput,
): Promise<DiscoverViaSearchResult> {
  const queries = input.queries ?? DEFAULT_SEARCH_QUERIES;
  const perQuery = input.perQuery ?? 30;
  const seen = new Map<string, DiscoveryCandidate>(); // dedup by sourceIdentifier across queries
  const failedQueries: Array<{ query: string; error: string }> = [];
  let rawCount = 0;

  for (const query of queries) {
    try {
      const { body } = await searchRepositories(query, input.credentials, perQuery);
      rawCount += body.items.length;
      for (const item of body.items) {
        if (!repoIsLikelyTool(item.full_name, item.name)) continue;
        if (item.archived) continue; // archived repos aren't actively tracked
        if (seen.has(item.full_name)) {
          // Keep the higher-star version; identical entries are idempotent
          const existing = seen.get(item.full_name)!;
          if (item.stargazers_count > existing.starsCount) {
            seen.set(item.full_name, {
              ...existing,
              starsCount: item.stargazers_count,
            });
          }
          continue;
        }
        seen.set(item.full_name, {
          sourceIdentifier:  item.full_name,
          displayName:       item.name,
          description:       item.description,
          starsCount:        item.stargazers_count,
          homepageUrl:       item.homepage ?? null,
          discoverySource:   "github_search",
          awesomeListSource: null,
        });
      }
    } catch (err) {
      failedQueries.push({
        query,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sort by stars descending so Marcel sees highest-impact candidates first.
  const candidates = Array.from(seen.values()).sort(
    (a, b) => b.starsCount - a.starsCount,
  );

  return { candidates, rawCount, failedQueries };
}
