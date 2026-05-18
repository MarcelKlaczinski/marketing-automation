import { describe, it, expect, beforeEach, mock } from "bun:test";
import oauthTokenFixture from "./fixtures/oauth-token-response.json";
import listingFixture from "./fixtures/subreddit-listing-success.json";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CREDS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  userAgent: "marketing-auto:1.0 (by /u/testuser)",
};

function makeTokenResponse(overrides: Partial<typeof oauthTokenFixture> = {}) {
  return new Response(JSON.stringify({ ...oauthTokenFixture, ...overrides }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeListingResponse(rateLimitRemaining = 98) {
  return new Response(JSON.stringify(listingFixture), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": String(rateLimitRemaining),
      "x-ratelimit-reset": "60",
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getAccessToken", () => {
  beforeEach(async () => {
    // Clear the module-level token cache between tests by re-importing with a fresh clientId
  });

  it("fetches a new token when cache is empty", async () => {
    const fetchMock = mock(() => Promise.resolve(makeTokenResponse()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Use a unique clientId per test to avoid cache interference
    const { getAccessToken } = await import(`../src/client.ts?v=${Math.random()}`);
    const creds = { ...TEST_CREDS, clientId: `test-${Date.now()}` };
    const token = await getAccessToken(creds);

    expect(token).toBe("test-access-token-abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallUrl = (fetchMock.mock.calls as unknown as Array<[string]>)[0]?.[0];
    expect(firstCallUrl).toBe("https://www.reddit.com/api/v1/access_token");
  });

  it("throws RedditAuthError on non-2xx token response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as unknown as typeof fetch;

    const { getAccessToken, RedditAuthError } = await import(`../src/client.ts?v=${Math.random()}`);
    const creds = { ...TEST_CREDS, clientId: `fail-${Date.now()}` };

    await expect(getAccessToken(creds)).rejects.toBeInstanceOf(RedditAuthError);
  });
});

describe("fetchSubredditPosts", () => {
  it("returns posts and rateLimitRemaining from response headers", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeTokenResponse());
      return Promise.resolve(makeListingResponse(95));
    }) as unknown as typeof fetch;

    const { getAccessToken, fetchSubredditPosts } = await import(
      `../src/client.ts?v=${Math.random()}`
    );
    const creds = { ...TEST_CREDS, clientId: `listing-${Date.now()}` };
    const token = await getAccessToken(creds);

    const result = await fetchSubredditPosts({
      subreddit: "ClaudeAI",
      sortMode: "top",
      timeWindow: "week",
      limit: 100,
      token,
      userAgent: creds.userAgent,
    });

    expect(result.rateLimitRemaining).toBe(95);
    expect(result.posts.length).toBe(listingFixture.data.children.length);
  });

  it("throws RedditApiError with status 429 on rate limit", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "45" },
        }),
      ),
    ) as unknown as typeof fetch;

    const { fetchSubredditPosts, RedditApiError } = await import(
      `../src/client.ts?v=${Math.random()}`
    );

    await expect(
      fetchSubredditPosts({
        subreddit: "LocalLLaMA",
        sortMode: "hot",
        timeWindow: "day",
        limit: 50,
        token: "some-token",
        userAgent: TEST_CREDS.userAgent,
      }),
    ).rejects.toBeInstanceOf(RedditApiError);
  });
});
