import { searchResponseSchema, type GitHubSearchResponse } from "./types.ts";

export interface GitHubCredentials {
  personalAccessToken: string;
}

const API_BASE = "https://api.github.com";

export class GitHubAuthError extends Error {
  public readonly githubErrorKind = "auth";
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export class GitHubRateLimitError extends Error {
  public readonly githubErrorKind = "rate_limit";
  constructor(message: string) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

export async function searchRepositories(
  query: string,
  credentials: GitHubCredentials,
  perPage: number = 30,
): Promise<GitHubSearchResponse> {
  const url = `${API_BASE}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.personalAccessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "toolwiki-signal-collector",
    },
  });

  if (response.status === 401) {
    throw new GitHubAuthError("Invalid GitHub PAT");
  }

  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new GitHubRateLimitError("GitHub API rate limit exceeded");
    }
    throw new GitHubAuthError("GitHub API forbidden");
  }

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return searchResponseSchema.parse(data);
}

export { API_BASE };
