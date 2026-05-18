import { describe, it, expect, mock } from "bun:test";
import { searchRepositories, GitHubAuthError, GitHubRateLimitError } from "../src/client.ts";
import searchFixture from "./fixtures/search-new-rising.json";
import emptyFixture from "./fixtures/search-empty.json";

const CREDS = { personalAccessToken: "ghp_test123" };

describe("searchRepositories", () => {
  it("returns parsed response on 200", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(searchFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await searchRepositories("topic:llm stars:>20", CREDS, 30);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.full_name).toBe("acme/awesome-llm");
  });

  it("encodes query in URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(JSON.stringify(emptyFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await searchRepositories("topic:ai tools stars:>20", CREDS, 30);
    expect(capturedUrl).toContain(encodeURIComponent("topic:ai tools stars:>20"));
  });

  it("throws GitHubAuthError on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 401 })),
    ) as unknown as typeof fetch;

    await expect(searchRepositories("q", CREDS)).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("throws GitHubRateLimitError on 403 with x-ratelimit-remaining=0", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(searchRepositories("q", CREDS)).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubAuthError on 403 without rate-limit header", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 403 })),
    ) as unknown as typeof fetch;

    await expect(searchRepositories("q", CREDS)).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("throws generic Error on other non-ok status", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 500, statusText: "Server Error" })),
    ) as unknown as typeof fetch;

    await expect(searchRepositories("q", CREDS)).rejects.toThrow("GitHub API 500");
  });
});
