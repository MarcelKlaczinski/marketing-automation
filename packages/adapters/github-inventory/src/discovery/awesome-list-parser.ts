/**
 * Spec 64.20 follow-up A2 — Awesome-list discovery source.
 *
 * Fetches README.md from a curated list-repo via GitHub contents API and
 * extracts `owner/repo` references that match common awesome-list markdown
 * patterns. Returns DiscoveryCandidate[] for downstream dedup + insert.
 *
 * Default targets (per Marcel-decision Spec 64.20 follow-up §A2):
 * - ComposioHQ/awesome-claude-skills
 * - BehiSecc/awesome-claude-skills
 * - travisvn/awesome-claude-skills
 *
 * The parser is intentionally minimal — handles only `[name](https://github.com/owner/repo)`
 * link form. Other awesome-list styles (raw URL, badge-wrapped, etc.) get
 * skipped. Brittle by design: cheap heuristic over generalized markdown
 * parser; we cap quality via Marcel's approve-gate, not via perfect parsing.
 */

import { fetchRepoContents } from "../client.ts";
import type { GitHubCredentials } from "../types.ts";
import type { DiscoveryCandidate } from "./search-api.ts";

/**
 * The 3 curated lists Marcel approved in Spec 64.20 §11 question 4.
 * Each entry: `owner/repo` of the list repo itself. Parser fetches `README.md`
 * from each via the contents API.
 */
export const DEFAULT_AWESOME_LISTS: readonly string[] = [
  "ComposioHQ/awesome-claude-skills",
  "BehiSecc/awesome-claude-skills",
  "travisvn/awesome-claude-skills",
];

/**
 * Regex captures the canonical awesome-list reference form:
 *   `[anything](https://github.com/owner/repo)` — with optional trailing slash,
 *   `:subdir` for mono-repo refs (anthropics/skills:web-design), and `#anchor`.
 *
 * Owner + repo must each be at least 2 chars; max 100 to filter junk.
 * Owner can have `-` (already filtered out by GitHub); repo can have `_`+`.`.
 */
const GITHUB_LINK_PATTERN =
  /\[([^\]]+)\]\(https:\/\/github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{1,99})\/([a-zA-Z0-9._][a-zA-Z0-9._-]{1,99})\)/g;

/** Extract `owner/repo` slugs + display text from a markdown body. Exported for tests. */
export function parseGithubLinksFromMarkdown(
  body: string,
): Array<{ sourceIdentifier: string; displayName: string }> {
  // Pre-strip badge images (`![alt](url)`) so they don't confuse the outer
  // link-pattern. Awesome-lists commonly wrap entries like
  // `[![badge](shield) ToolName](https://github.com/foo/bar)` — the inner
  // `[` breaks the simple `\[([^\]]+)\]` capture group.
  const stripped = body.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  const found = new Map<string, string>();
  for (const match of stripped.matchAll(GITHUB_LINK_PATTERN)) {
    const displayText = match[1]?.trim() ?? "";
    const owner = match[2];
    const repo = match[3];
    if (!owner || !repo) continue;
    const sourceIdentifier = `${owner}/${repo}`;

    // Skip self-references (the awesome-list referencing itself).
    if (DEFAULT_AWESOME_LISTS.some((l) => l.toLowerCase() === sourceIdentifier.toLowerCase())) {
      continue;
    }

    // Strip markdown emphasis from display text.
    const cleaned = displayText.replace(/^\*+|\*+$/g, "").trim();

    if (!found.has(sourceIdentifier)) {
      found.set(sourceIdentifier, cleaned || repo);
    }
  }
  return Array.from(found.entries()).map(([sourceIdentifier, displayName]) => ({
    sourceIdentifier,
    displayName,
  }));
}

/** Decode base64 GitHub contents (with embedded newlines) to UTF-8 text. */
function decodeBase64(b64: string): string {
  const cleaned = b64.replace(/\n/g, "");
  return Buffer.from(cleaned, "base64").toString("utf-8");
}

export interface DiscoverViaAwesomeListsInput {
  credentials: GitHubCredentials;
  /** Override the default list set. */
  lists?: readonly string[];
}

export interface DiscoverViaAwesomeListsResult {
  candidates: DiscoveryCandidate[];
  /** Per-list count of links found pre-dedup. */
  perListCounts: Array<{ list: string; linksFound: number }>;
  /** Lists that errored — empty when all succeeded. */
  failedLists: Array<{ list: string; error: string }>;
}

export async function discoverViaAwesomeLists(
  input: DiscoverViaAwesomeListsInput,
): Promise<DiscoverViaAwesomeListsResult> {
  const lists = input.lists ?? DEFAULT_AWESOME_LISTS;
  const seen = new Map<string, DiscoveryCandidate>();
  const perListCounts: Array<{ list: string; linksFound: number }> = [];
  const failedLists: Array<{ list: string; error: string }> = [];

  for (const list of lists) {
    try {
      const { body } = await fetchRepoContents(list, "README.md", input.credentials);
      if (!body) {
        failedLists.push({ list, error: "README.md not found" });
        continue;
      }
      const markdown = decodeBase64(body.content);
      const links = parseGithubLinksFromMarkdown(markdown);
      perListCounts.push({ list, linksFound: links.length });

      for (const link of links) {
        if (seen.has(link.sourceIdentifier)) continue;
        seen.set(link.sourceIdentifier, {
          sourceIdentifier:  link.sourceIdentifier,
          displayName:       link.displayName,
          description:       null,
          starsCount:        0, // unknown without an extra repo-metadata call
          homepageUrl:       null,
          discoverySource:   "awesome_list",
          awesomeListSource: list,
        });
      }
    } catch (err) {
      failedLists.push({
        list,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const candidates = Array.from(seen.values());
  return { candidates, perListCounts, failedLists };
}
