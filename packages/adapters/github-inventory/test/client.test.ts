// Spec 64.20 — adapter client tests. Mocked fetch; offline.
import { describe, expect, it, mock } from "bun:test";
import {
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTransportError,
  fetchLatestRelease,
  fetchRateLimit,
  fetchRepoMetadata,
} from "../src/client.ts";
import rateLimitFixture from "./fixtures/rate-limit.json";
import releaseFixture from "./fixtures/release-v1.json";
import repoFixture from "./fixtures/repo-anthropics-claude-code.json";

const CREDS = { personalAccessToken: "ghp_test123" };

const stdHeaders = {
  "x-ratelimit-remaining": "4987",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": "1800000000",
  "Content-Type": "application/json",
};

function ok(body: unknown, headers: Record<string, string> = stdHeaders): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe("fetchRepoMetadata", () => {
  it("returns parsed body + rateLimit snapshot on 200", async () => {
    globalThis.fetch = mock(() => Promise.resolve(ok(repoFixture))) as unknown as typeof fetch;
    const result = await fetchRepoMetadata("anthropics/claude-code", CREDS);
    expect(result.body.full_name).toBe("anthropics/claude-code");
    expect(result.body.stargazers_count).toBe(25000);
    expect(result.body.default_branch).toBe("main");
    expect(result.rateLimit?.remaining).toBe(4987);
    expect(result.rateLimit?.limit).toBe(5000);
    expect(result.rateLimit?.resetAt.getTime()).toBe(1800000000 * 1000);
  });

  it("sends correct auth + version headers", async () => {
    let captured: Record<string, string> | null = null;
    globalThis.fetch = mock((_url: string | URL | Request, init: RequestInit | undefined) => {
      const headers = init?.headers as Record<string, string> | undefined;
      captured = headers ?? null;
      return Promise.resolve(ok(repoFixture));
    }) as unknown as typeof fetch;
    await fetchRepoMetadata("anthropics/claude-code", CREDS);
    expect(captured).not.toBeNull();
    expect(captured!.Authorization).toBe("Bearer ghp_test123");
    expect(captured!.Accept).toBe("application/vnd.github+json");
    expect(captured!["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(captured!["User-Agent"]).toBe("toolwiki-inventory");
  });

  it("throws GitHubAuthError on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 401 })),
    ) as unknown as typeof fetch;
    await expect(fetchRepoMetadata("a/b", CREDS)).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("throws GitHubRateLimitError on 403 with x-ratelimit-remaining=0", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-reset": "1800000000",
          },
        }),
      ),
    ) as unknown as typeof fetch;
    const err = await fetchRepoMetadata("a/b", CREDS).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubRateLimitError);
    expect((err as GitHubRateLimitError).resetAt?.getTime()).toBe(1800000000 * 1000);
  });

  it("throws GitHubRateLimitError on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 429 })),
    ) as unknown as typeof fetch;
    await expect(fetchRepoMetadata("a/b", CREDS)).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubNotFoundError on 404 (no allow404)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 404 })),
    ) as unknown as typeof fetch;
    await expect(fetchRepoMetadata("ghost/repo", CREDS)).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );
  });

  it("retries on 5xx and succeeds on third attempt", async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      if (calls <= 2) {
        return Promise.resolve(new Response("server error", { status: 502 }));
      }
      return Promise.resolve(ok(repoFixture));
    }) as unknown as typeof fetch;
    const result = await fetchRepoMetadata("anthropics/claude-code", CREDS);
    expect(calls).toBe(3);
    expect(result.body.full_name).toBe("anthropics/claude-code");
  });

  it("throws GitHubTransportError after retries exhausted on persistent 5xx", async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(new Response("nope", { status: 503 }));
    }) as unknown as typeof fetch;
    const err = await fetchRepoMetadata("a/b", CREDS).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubTransportError);
    expect(calls).toBe(4); // initial + 3 retries
  });

  it("retries on network error and succeeds", async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return Promise.resolve(ok(repoFixture));
    }) as unknown as typeof fetch;
    const result = await fetchRepoMetadata("anthropics/claude-code", CREDS);
    expect(calls).toBe(2);
    expect(result.body.full_name).toBe("anthropics/claude-code");
  });
});

describe("fetchLatestRelease", () => {
  it("returns parsed release on 200", async () => {
    globalThis.fetch = mock(() => Promise.resolve(ok(releaseFixture))) as unknown as typeof fetch;
    const result = await fetchLatestRelease("anthropics/claude-code", CREDS);
    expect(result.body?.tag_name).toBe("v1.0.0");
    expect(result.body?.name).toBe("First Release");
  });

  it("returns body=null on 404 (no releases yet)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 404 })),
    ) as unknown as typeof fetch;
    const result = await fetchLatestRelease("ghost/repo", CREDS);
    expect(result.body).toBeNull();
  });
});

describe("fetchRateLimit", () => {
  it("returns RateLimitSnapshot from /rate_limit endpoint", async () => {
    globalThis.fetch = mock(() => Promise.resolve(ok(rateLimitFixture))) as unknown as typeof fetch;
    const result = await fetchRateLimit(CREDS);
    expect(result.remaining).toBe(4987);
    expect(result.limit).toBe(5000);
    expect(result.resetAt.getTime()).toBe(1800000000 * 1000);
  });
});
