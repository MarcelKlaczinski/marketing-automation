import { describe, it, expect } from "bun:test";
import { mock } from "bun:test";
import { RedditSignalSource } from "../src/index.ts";
import listingFixture from "./fixtures/subreddit-listing-success.json";
import oauthTokenFixture from "./fixtures/oauth-token-response.json";

// Fresh credentials per test call — avoids token-cache cross-contamination between tests
function freshCredentials() {
  return {
    clientId: `norm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    clientSecret: "test-secret",
    userAgent: "marketing-auto:1.0 (by /u/testuser)",
  };
}

function makeBaseInput() {
  return {
    subreddits: ["ClaudeAI"],
    sortMode: "top" as const,
    timeWindow: "week" as const,
    minUpvotes: 50,
    minComments: 10,
    maxAgeDays: 9999, // fixture uses fixed timestamps — don't age-filter in unit tests
    limit: 100,
    credentials: freshCredentials(),
  };
}

function makeMocks(overrideListing?: () => Response) {
  let callCount = 0;
  globalThis.fetch = mock((url: string | URL | Request) => {
    callCount++;
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("access_token")) {
      return Promise.resolve(
        new Response(JSON.stringify(oauthTokenFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (overrideListing) {
      return Promise.resolve(overrideListing());
    }
    return Promise.resolve(
      new Response(JSON.stringify(listingFixture), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-remaining": "98",
        },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("RedditSignalSource normalization", () => {
  it("filters out stickied posts", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const signals = await source.fetch(makeBaseInput(), { projectId: "test-project" });

    const ids = signals.map((s) => s.externalId);
    expect(ids).not.toContain("t3_3ghi890");
  });

  it("filters out NSFW posts", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const signals = await source.fetch(makeBaseInput(), { projectId: "test-project" });

    const ids = signals.map((s) => s.externalId);
    expect(ids).not.toContain("t3_4jkl123");
  });

  it("filters out posts below minUpvotes threshold", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const signals = await source.fetch(makeBaseInput(), { projectId: "test-project" });

    const ids = signals.map((s) => s.externalId);
    expect(ids).not.toContain("t3_5mno456");
  });

  it("uses permalink URL for self-posts", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const signals = await source.fetch(makeBaseInput(), { projectId: "test-project" });

    const selfPost = signals.find((s) => s.externalId === "t3_2def567");
    expect(selfPost).toBeDefined();
    expect(selfPost?.url).toBe(
      "https://reddit.com/r/ClaudeAI/comments/2def567/my_experience_using_claude/",
    );
  });

  it("uses original URL for link posts", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const signals = await source.fetch(makeBaseInput(), { projectId: "test-project" });

    const linkPost = signals.find((s) => s.externalId === "t3_1abc234");
    expect(linkPost).toBeDefined();
    expect(linkPost?.url).toBe("https://anthropic.com/news/claude-3-5-sonnet");
  });

  it("includes selftext as summary for self-posts", async () => {
    makeMocks();
    const source = new RedditSignalSource();
    const input = { ...makeBaseInput(), minUpvotes: 0, minComments: 0 };
    const signals = await source.fetch(input, { projectId: "test-project" });

    const selfPost = signals.find((s) => s.externalId === "t3_2def567");
    expect(typeof selfPost?.summary).toBe("string");
    expect((selfPost?.summary as string)).toContain("After using Claude");
  });

  it("continues collecting when one subreddit fails", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("access_token")) {
        return Promise.resolve(
          new Response(JSON.stringify(oauthTokenFixture), { status: 200 }),
        );
      }
      if (urlStr.includes("FailSub")) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(listingFixture), {
          status: 200,
          headers: { "x-ratelimit-remaining": "98" },
        }),
      );
    }) as unknown as typeof fetch;

    const source = new RedditSignalSource();
    const input = { ...makeBaseInput(), subreddits: ["ClaudeAI", "FailSub"], minUpvotes: 0, minComments: 0 };
    const signals = await source.fetch(input, { projectId: "test-project" });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.source === "reddit")).toBe(true);
  });
});
