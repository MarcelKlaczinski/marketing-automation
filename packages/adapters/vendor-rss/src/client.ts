import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10_000,
  headers: { "User-Agent": "marketing-auto-signal-collector/1.0" },
});

export type FeedItem = {
  guid?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
  author?: string;
};

export async function fetchFeed(feedUrl: string): Promise<{
  feedTitle: string;
  items: FeedItem[];
}> {
  const feed = await parser.parseURL(feedUrl);
  return {
    feedTitle: feed.title ?? feedUrl,
    items: (feed.items as FeedItem[]) ?? [],
  };
}
