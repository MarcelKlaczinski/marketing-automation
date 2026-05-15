import { describe, it, expect, mock } from "bun:test";

const now = Date.now();
const fakeFeed = {
  feedTitle: "Test Feed",
  items: [
    {
      title: "Recent Post",
      link: "https://example.com/a",
      guid: "https://example.com/a",
      isoDate: new Date(now - 2 * 86_400_000).toISOString(),
    },
    {
      title: "Old Post",
      link: "https://example.com/b",
      guid: "https://example.com/b",
      isoDate: new Date(now - 30 * 86_400_000).toISOString(),
    },
    {
      title: "Undated Post",
      link: "https://example.com/c",
      guid: "https://example.com/c",
      // no isoDate, no pubDate
    },
  ],
};

mock.module("../src/client.ts", () => ({
  fetchFeed: mock(async (_url: string) => fakeFeed),
}));

const ctx = { projectId: "test-project" };

describe("VendorRssSignalSource — date filtering", () => {
  it("maxAgeDays: 14 → only the recent item (A) is returned", async () => {
    const { VendorRssSignalSource } = await import("../src/signal-source.ts");
    const source = new VendorRssSignalSource();
    const signals = await source.fetch(
      { feeds: ["https://example.com/feed.xml"], maxAgeDays: 14 },
      ctx,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.title).toBe("Recent Post");
  });

  it("maxAgeDays: 365 → items A and B returned (undated C always dropped)", async () => {
    const { VendorRssSignalSource } = await import("../src/signal-source.ts");
    const source = new VendorRssSignalSource();
    const signals = await source.fetch(
      { feeds: ["https://example.com/feed.xml"], maxAgeDays: 365 },
      ctx,
    );
    expect(signals).toHaveLength(2);
    const titles = signals.map((s) => s.title);
    expect(titles).toContain("Recent Post");
    expect(titles).toContain("Old Post");
  });
});
