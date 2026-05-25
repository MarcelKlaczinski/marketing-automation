/**
 * Spec 64.20: low-level GitHub-API client for the inventory adapter.
 *
 * - PAT-Bearer auth, `X-GitHub-Api-Version: 2022-11-28`.
 * - Retry on 5xx + network errors (3 attempts, 500/1000/2000ms backoff).
 * - 4xx fail-fast — 401/403(remaining=0)/404 mapped to discriminated error classes.
 * - Every successful response surfaces a `RateLimitSnapshot` parsed from headers
 *   so callers can implement throttling without a separate `/rate_limit` round-trip.
 */
import {
  rawRateLimitSchema,
  rawRepoSchema,
  rawReleaseSchema,
  rawContentFileSchema,
} from "./schemas.ts";
import type {
  GitHubCredentials,
  RateLimitSnapshot,
} from "./types.ts";

export const API_BASE = "https://api.github.com";
export const USER_AGENT = "toolwiki-inventory";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000];

export class GitHubAuthError extends Error {
  public readonly githubErrorKind = "auth" as const;
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export class GitHubRateLimitError extends Error {
  public readonly githubErrorKind = "rate_limit" as const;
  public readonly resetAt: Date | null;
  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export class GitHubNotFoundError extends Error {
  public readonly githubErrorKind = "not_found" as const;
  constructor(message: string) {
    super(message);
    this.name = "GitHubNotFoundError";
  }
}

export class GitHubTransportError extends Error {
  public readonly githubErrorKind = "transport" as const;
  constructor(message: string) {
    super(message);
    this.name = "GitHubTransportError";
  }
}

function buildHeaders(creds: GitHubCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.personalAccessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

function parseRateLimitHeaders(response: Response): RateLimitSnapshot | null {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const limit = response.headers.get("x-ratelimit-limit");
  const reset = response.headers.get("x-ratelimit-reset");
  if (remaining === null || limit === null || reset === null) return null;
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    resetAt: new Date(Number(reset) * 1000),
  };
}

interface DoRequestResult {
  response: Response;
  rateLimit: RateLimitSnapshot | null;
}

/**
 * Perform a GitHub-API GET with retry + error-mapping.
 * Caller-side: pass `allow404=true` if you want 404 returned as `null` shape
 * (e.g. `/releases/latest` for a repo with no releases) instead of thrown.
 */
async function doGet(
  path: string,
  creds: GitHubCredentials,
  opts: { allow404?: boolean } = {},
): Promise<DoRequestResult | { response: null; rateLimit: null }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: buildHeaders(creds),
      });
      const rateLimit = parseRateLimitHeaders(response);

      // Hard 4xx — no retry
      if (response.status === 401) {
        throw new GitHubAuthError("Invalid GitHub PAT");
      }
      if (response.status === 403) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        if (remaining === "0") {
          throw new GitHubRateLimitError(
            "GitHub API rate limit exceeded",
            rateLimit?.resetAt ?? null,
          );
        }
        throw new GitHubAuthError("GitHub API forbidden (token lacks scope?)");
      }
      if (response.status === 404) {
        if (opts.allow404) {
          return { response: null, rateLimit: null };
        }
        throw new GitHubNotFoundError(`GitHub resource not found: ${path}`);
      }
      if (response.status === 429) {
        throw new GitHubRateLimitError(
          "GitHub API throttled (429)",
          rateLimit?.resetAt ?? null,
        );
      }
      if (response.status >= 500 && response.status < 600) {
        // Retryable
        lastError = new Error(`GitHub API ${response.status}: ${response.statusText}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
          continue;
        }
        throw new GitHubTransportError(
          `GitHub API ${response.status} after ${MAX_RETRIES + 1} attempts: ${response.statusText}`,
        );
      }
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
      }

      return { response, rateLimit };
    } catch (err) {
      // Re-throw mapped errors immediately
      if (
        err instanceof GitHubAuthError ||
        err instanceof GitHubRateLimitError ||
        err instanceof GitHubNotFoundError ||
        err instanceof GitHubTransportError
      ) {
        throw err;
      }
      // Network errors are retryable
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }
      throw new GitHubTransportError(
        `GitHub API transport failure after ${MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // Unreachable — loop either returns or throws
  throw new GitHubTransportError(
    `Unreachable retry exhaustion: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public fetchers ────────────────────────────────────────────────────────

/** `GET /repos/{owner}/{repo}` — full repo metadata. */
export async function fetchRepoMetadata(fullName: string, creds: GitHubCredentials) {
  const { response, rateLimit } = await doGet(`/repos/${fullName}`, creds);
  if (!response) {
    // doGet with allow404=undefined never returns null here, but TS narrowing requires this branch
    throw new GitHubNotFoundError(`GitHub repo not found: ${fullName}`);
  }
  const data = await response.json();
  return { body: rawRepoSchema.parse(data), rateLimit };
}

/**
 * `GET /repos/{owner}/{repo}/releases/latest` — returns `body: null` for repos
 * with no releases (404 is the GitHub convention for "no releases yet").
 */
export async function fetchLatestRelease(fullName: string, creds: GitHubCredentials) {
  const result = await doGet(`/repos/${fullName}/releases/latest`, creds, {
    allow404: true,
  });
  if (!result.response) {
    return { body: null, rateLimit: null };
  }
  const data = await result.response.json();
  return { body: rawReleaseSchema.parse(data), rateLimit: result.rateLimit };
}

/**
 * `GET /repos/{owner}/{repo}/contents/{path}` — returns base64 content for a single file.
 * Returns `body: null` if the file doesn't exist (404).
 */
export async function fetchRepoContents(
  fullName: string,
  path: string,
  creds: GitHubCredentials,
) {
  const result = await doGet(`/repos/${fullName}/contents/${path}`, creds, {
    allow404: true,
  });
  if (!result.response) {
    return { body: null, rateLimit: null };
  }
  const data = await result.response.json();
  // 404-safe but also "dir-listing" safe: if the path is a directory, GitHub
  // returns an array. We only handle the single-file shape here — callers
  // requesting directories should get null + fall back to a list call.
  if (Array.isArray(data)) {
    return { body: null, rateLimit: result.rateLimit };
  }
  return { body: rawContentFileSchema.parse(data), rateLimit: result.rateLimit };
}

/** `GET /rate_limit` — never fails on rate-limit (the endpoint itself doesn't count). */
export async function fetchRateLimit(creds: GitHubCredentials): Promise<RateLimitSnapshot> {
  const { response } = await doGet(`/rate_limit`, creds);
  if (!response) {
    throw new GitHubTransportError("rate_limit endpoint returned null body");
  }
  const data = await response.json();
  const parsed = rawRateLimitSchema.parse(data);
  return {
    remaining: parsed.resources.core.remaining,
    limit: parsed.resources.core.limit,
    resetAt: new Date(parsed.resources.core.reset * 1000),
  };
}
