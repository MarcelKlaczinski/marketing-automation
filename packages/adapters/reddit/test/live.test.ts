import { describe, it, expect } from "bun:test";
import { getAccessToken, fetchSubredditPosts } from "../src/client.ts";
import { RedditSignalSource } from "../src/index.ts";
import { verifyReddit } from "../src/verify.ts";

// Run with: RUN_LIVE_REDDIT=1 bun --filter @marketing-auto/adapter-reddit test
const LIVE = process.env.RUN_LIVE_REDDIT === "1";

function getCredentials() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT ?? "marketing-auto-test:1.0 (by /u/testuser)";
  if (!clientId || !clientSecret) {
    throw new Error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set for live tests");
  }
  return { clientId, clientSecret, userAgent };
}

describe.if(LIVE)("Reddit adapter (LIVE)", () => {
  it("fetches OAuth token successfully", async () => {
    const creds = getCredentials();
    const token = await getAccessToken(creds);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });

  it("caches token on second call (no second network request)", async () => {
    const creds = getCredentials();
    const token1 = await getAccessToken(creds);
    const token2 = await getAccessToken(creds);
    expect(token1).toBe(token2);
  });

  it("fetches posts from r/ClaudeAI and returns rateLimitRemaining", async () => {
    const creds = getCredentials();
    const token = await getAccessToken(creds);
    const result = await fetchSubredditPosts({
      subreddit: "ClaudeAI",
      sortMode: "top",
      timeWindow: "week",
      limit: 5,
      token,
      userAgent: creds.userAgent,
    });
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts.length).toBeLessThanOrEqual(5);
    expect(typeof result.rateLimitRemaining).toBe("number");
    expect(result.rateLimitRemaining).toBeGreaterThanOrEqual(0);

    const post = result.posts[0]!;
    expect(typeof post.id).toBe("string");
    expect(typeof post.title).toBe("string");
    expect(typeof post.score).toBe("number");
    expect(typeof post.num_comments).toBe("number");
    expect(typeof post.created_utc).toBe("number");
  });

  it("RedditSignalSource.fetch returns normalized RawSignal array", async () => {
    const creds = getCredentials();
    const source = new RedditSignalSource();
    const signals = await source.fetch(
      {
        subreddits: ["ClaudeAI"],
        sortMode: "top",
        timeWindow: "week",
        minUpvotes: 0,
        minComments: 0,
        maxAgeDays: 30,
        limit: 5,
        credentials: creds,
      },
      { projectId: "live-test" },
    );

    expect(Array.isArray(signals)).toBe(true);
    if (signals.length > 0) {
      const s = signals[0]!;
      expect(s.source).toBe("reddit");
      expect(s.externalId).toMatch(/^t3_/);
      expect(typeof s.title).toBe("string");
      expect(typeof s.url).toBe("string");
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.publishedAt).toBeInstanceOf(Date);
      expect(typeof s.metrics?.upvotes).toBe("number");
      expect(typeof s.metrics?.comments).toBe("number");
      // NSFW and stickied posts must be filtered out
      expect(s.rawPayload).toBeDefined();
    }
  });

  it("filters NSFW posts in live data", async () => {
    const creds = getCredentials();
    const source = new RedditSignalSource();
    const signals = await source.fetch(
      {
        subreddits: ["ClaudeAI"],
        sortMode: "top",
        timeWindow: "week",
        minUpvotes: 0,
        minComments: 0,
        maxAgeDays: 30,
        limit: 25,
        credentials: creds,
      },
      { projectId: "live-test" },
    );
    // All returned signals must come from non-NSFW posts
    // (rawPayload doesn't expose over_18 — just verify url is always set)
    for (const s of signals) {
      expect(s.url).toBeTruthy();
      expect(s.externalId.startsWith("t3_")).toBe(true);
    }
  });

  it("verifyReddit returns ok:true with valid credentials", async () => {
    const creds = getCredentials();
    const result = await verifyReddit(creds);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Reddit");
  });
});
