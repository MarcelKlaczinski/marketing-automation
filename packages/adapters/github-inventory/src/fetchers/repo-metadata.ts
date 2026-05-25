/**
 * Spec 64.20: high-level composer — turns 2 GitHub-API calls into the
 * `GithubInventoryMetadata` shape that the DB column expects.
 *
 * The output shape matches `githubInventoryMetadataSchema` from
 * `@marketing-auto/db` exactly. Spec 64.20 §3.3 / §4.3.
 */
import { fetchLatestRelease, fetchRepoMetadata } from "../client.ts";
import type { GitHubCredentials, RateLimitSnapshot } from "../types.ts";

/**
 * Mirror of `GithubInventoryMetadata` from `@marketing-auto/db`. We re-declare
 * here to avoid a leaf-adapter → db dependency (Memory: adapters stay leaf,
 * domain types are duplicated where structural compatibility is enforced via
 * a `satisfies` check at the consumer side).
 */
export interface GithubInventoryMetadata {
  starsCount: number;
  forksCount: number;
  watchersCount?: number;
  primaryLanguage: string | null;
  license: string | null;
  topics: string[];
  defaultBranch: string;
  createdAt: string;
  pushedAt: string;
  latestRelease: {
    tag: string;
    name: string | null;
    publishedAt: string;
  } | null;
  skillFrontmatter?: {
    name: string;
    description: string;
    category?: string;
    version?: string;
  };
}

export interface FetchFullRepoMetadataResult {
  metadata: GithubInventoryMetadata;
  /** From the LAST request that surfaced a rate-limit snapshot (releases call). */
  rateLimit: RateLimitSnapshot | null;
}

/**
 * Compose repo + latest-release into a single `GithubInventoryMetadata` blob.
 *
 * Failures:
 * - Repo `404` → `GitHubNotFoundError` bubbles (the row is mis-configured).
 * - Releases `404` → release: `null` in output (most repos have no releases).
 * - Rate-limit / auth → bubble up; worker handles.
 */
export async function fetchFullRepoMetadata(
  fullName: string,
  creds: GitHubCredentials,
): Promise<FetchFullRepoMetadataResult> {
  const repo = await fetchRepoMetadata(fullName, creds);
  const release = await fetchLatestRelease(fullName, creds);

  const metadata: GithubInventoryMetadata = {
    starsCount: repo.body.stargazers_count,
    forksCount: repo.body.forks_count,
    watchersCount: repo.body.watchers_count,
    primaryLanguage: repo.body.language ?? null,
    license: repo.body.license?.spdx_id ?? "no-license",
    topics: repo.body.topics ?? [],
    defaultBranch: repo.body.default_branch,
    // GitHub returns ISO 8601 strings; pass through unchanged
    createdAt: repo.body.created_at,
    pushedAt: repo.body.pushed_at,
    latestRelease: release.body
      ? {
          tag: release.body.tag_name,
          name: release.body.name ?? null,
          publishedAt: release.body.published_at,
        }
      : null,
  };

  return { metadata, rateLimit: release.rateLimit ?? repo.rateLimit };
}
