/**
 * Spec 64.20: GitHub facts for a tool, sourced from `content_source_inventory`.
 * Populated by `resolveRelevantTools` via JOIN on `article_id`. Null when:
 * - the tool article has no inventory row, or
 * - the row's `fetch_status !== 'ok'` (never fetched, fetching, or errored), or
 * - the row's `approved_at IS NULL` (unapproved candidate from Auto-Discovery V1.1)
 */
export interface GithubFacts {
  starsCount: number;
  forksCount: number;
  primaryLanguage: string | null;
  license: string | null;
  latestRelease: { tag: string; publishedAt: string } | null;
  lastFetchedAt: string;
}

export interface ToolReference {
  slug: string;
  name: string;
  pricing: string | null;
  rating: number | null;
  shortDescription: string | null;
  features: string[];
  /** Spec 64.20: GitHub-side facts for comparison-prompt backing. */
  github: GithubFacts | null;
}

export interface RelevantTools {
  primary: ToolReference[];   // cluster-matched tools (LLM should use these)
  secondary: ToolReference[]; // top-3 in category by rating (LLM may use these)
}

export interface LinkifyResult {
  bodyMd: string;
  linksAdded: number;
  linkedTools: string[]; // slugs of tools that got linked
}
