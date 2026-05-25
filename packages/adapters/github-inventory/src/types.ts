/**
 * Spec 64.20: public types of the inventory adapter.
 * Inferred Zod types re-exported under simpler names for consumer convenience.
 */
export type {
  RawRepo as RepoMetadataResponse,
  RawRelease as ReleaseResponse,
  RawContentFile as ContentFileResponse,
  RawRateLimit as RateLimitResponse,
} from "./schemas.ts";

export interface GitHubCredentials {
  personalAccessToken: string;
}

/** Snapshot of the `x-ratelimit-*` response headers. Populated by every API call. */
export interface RateLimitSnapshot {
  /** Remaining API calls in the current window. */
  remaining: number;
  /** Total budget for the window (typically 5000 for PAT). */
  limit: number;
  /** When the window resets, as a Date. */
  resetAt: Date;
}

/** Discriminator literal on the adapter's error classes. */
export type GitHubErrorKind = "auth" | "rate_limit" | "not_found" | "transport";
