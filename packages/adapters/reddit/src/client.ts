import { oauthTokenResponseSchema, subredditListingResponseSchema } from "./types.ts";
import type { RawRedditPost } from "./types.ts";

// ─── Credentials ──────────────────────────────────────────────────────────────

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class RedditAuthError extends Error {
  public readonly redditAuthErrorKind = "auth" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RedditAuthError";
  }
}

export class RedditApiError extends Error {
  public readonly redditApiErrorKind = "api" as const;
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RedditApiError";
    this.status = status;
  }
}

// ─── Token cache (per clientId) ───────────────────────────────────────────────

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, OAuthToken>();

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const API_BASE = "https://oauth.reddit.com";

export async function getAccessToken(creds: RedditCredentials): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": creds.userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new RedditAuthError(
      `OAuth token request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const parsed = oauthTokenResponseSchema.parse(data);

  const token: OAuthToken = {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  tokenCache.set(creds.clientId, token);

  return token.accessToken;
}

// ─── Subreddit fetch ──────────────────────────────────────────────────────────

export interface FetchSubredditOptions {
  subreddit: string;
  sortMode: "top" | "hot" | "new";
  timeWindow: "day" | "week" | "month";
  limit: number;
  token: string;
  userAgent: string;
}

export interface FetchSubredditResult {
  posts: RawRedditPost[];
  rateLimitRemaining: number;
}

export async function fetchSubredditPosts(
  opts: FetchSubredditOptions,
): Promise<FetchSubredditResult> {
  const url = buildSubredditUrl(opts.subreddit, opts.sortMode, opts.timeWindow, opts.limit);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "User-Agent": opts.userAgent,
    },
  });

  const rateLimitRemaining = parseFloat(
    response.headers.get("x-ratelimit-remaining") ?? "Infinity",
  );

  if (response.status === 429) {
    const resetSeconds = parseFloat(response.headers.get("x-ratelimit-reset") ?? "60");
    throw new RedditApiError(
      `Rate limited on r/${opts.subreddit}; reset in ${resetSeconds}s`,
      429,
    );
  }

  if (!response.ok) {
    throw new RedditApiError(
      `Subreddit fetch failed for r/${opts.subreddit}: ${response.status}`,
      response.status,
    );
  }

  const data = await response.json();
  const parsed = subredditListingResponseSchema.parse(data);
  const posts = parsed.data.children.map((c) => c.data);

  return { posts, rateLimitRemaining };
}

function buildSubredditUrl(
  subreddit: string,
  sortMode: "top" | "hot" | "new",
  timeWindow: "day" | "week" | "month",
  limit: number,
): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sortMode === "top") params.set("t", timeWindow);
  return `${API_BASE}/r/${subreddit}/${sortMode}.json?${params.toString()}`;
}
