/**
 * Spec 64.20: `@marketing-auto/adapter-github-inventory` public surface.
 */

// Low-level client + error classes
export {
  API_BASE,
  USER_AGENT,
  GitHubAuthError,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubTransportError,
  fetchRepoMetadata,
  fetchLatestRelease,
  fetchRepoContents,
  fetchRateLimit,
  searchRepositories,
} from "./client.ts";

// Discovery — Spec 64.20 follow-up A2
export {
  discoverViaSearch,
  discoverViaAwesomeLists,
  parseGithubLinksFromMarkdown,
  DEFAULT_SEARCH_QUERIES,
  DEFAULT_AWESOME_LISTS,
  type DiscoveryCandidate,
  type DiscoverViaSearchInput,
  type DiscoverViaSearchResult,
  type DiscoverViaAwesomeListsInput,
  type DiscoverViaAwesomeListsResult,
} from "./discovery/index.ts";

// Composers
export {
  fetchFullRepoMetadata,
  type GithubInventoryMetadata,
  type FetchFullRepoMetadataResult,
} from "./fetchers/repo-metadata.ts";

export {
  detectSkill,
  parseSourceIdentifier,
  parseSkillFrontmatter,
  type SkillFrontmatter,
  type DetectSkillResult,
} from "./fetchers/skill-detector.ts";

// Live-verify
export { verifyGitHubInventory } from "./verify.ts";

// Types
export type {
  GitHubCredentials,
  RateLimitSnapshot,
  GitHubErrorKind,
  RepoMetadataResponse,
  ReleaseResponse,
  ContentFileResponse,
  RateLimitResponse,
} from "./types.ts";

// Re-export raw Zod schemas for advanced consumers
export {
  rawRepoSchema,
  rawReleaseSchema,
  rawContentFileSchema,
  rawRateLimitSchema,
} from "./schemas.ts";
