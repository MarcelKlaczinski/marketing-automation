import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { fetchFeed, type FeedItem } from "./client.ts";

const log = createLogger("adapter:vendor-rss");

const _InputSchema = z.object({
  feeds:      z.array(z.string().url()).min(1).max(50),
  maxAgeDays: z.number().int().min(1).max(365).default(14),
});

// Cast: resolves exactOptionalPropertyTypes variance for inputSchema.
const InputSchema = _InputSchema as z.ZodType<z.infer<typeof _InputSchema>>;

type Input = z.infer<typeof _InputSchema>;

export class VendorRssSignalSource implements ExternalSignalSource<Input> {
  readonly source = "vendor_rss" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input);
    const cutoff = new Date(Date.now() - parsed.maxAgeDays * 86_400_000);
    log.info({ projectId: ctx.projectId, feedCount: parsed.feeds.length, maxAgeDays: parsed.maxAgeDays }, "fetching RSS feeds");

    const results = await Promise.allSettled(
      parsed.feeds.map(async (url) => {
        const { feedTitle, items } = await fetchFeed(url);
        const afterDateFilter = items
          .filter((item: FeedItem) => item.title && (item.link ?? item.guid))
          .filter((item: FeedItem) => {
            const publishedAt = item.isoDate
              ? new Date(item.isoDate)
              : item.pubDate
                ? new Date(item.pubDate)
                : undefined;
            return publishedAt !== undefined && publishedAt >= cutoff;
          });
        log.debug({ url, total: items.length, afterDateFilter: afterDateFilter.length }, "RSS feed date-filtered");
        return afterDateFilter
          .map((item: FeedItem): RawSignal => {
            const url     = item.link;
            const summary = item.contentSnippet?.slice(0, 4500);
            const author  = item.creator ?? item.author ?? feedTitle;
            const publishedAt = item.isoDate
              ? new Date(item.isoDate)
              : item.pubDate
                ? new Date(item.pubDate)
                : undefined;
            return {
              source:     "vendor_rss" as const,
              externalId: (item.guid ?? item.link)!,
              title:      item.title!,
              rawPayload: { feedTitle, ...item } as Record<string, unknown>,
              metrics:    {},
              ...(url         && { url }),
              ...(summary     && { summary }),
              ...(author      && { author }),
              ...(publishedAt && { publishedAt }),
            };
          });
      }),
    );

    const signals: RawSignal[] = [];
    for (const [i, res] of results.entries()) {
      if (res.status === "fulfilled") {
        signals.push(...res.value);
      } else {
        log.error({ url: parsed.feeds[i], err: res.reason }, "RSS feed fetch failed");
      }
    }

    log.info({ count: signals.length, maxAgeDays: parsed.maxAgeDays }, "fetched RSS signals");
    return signals;
  }
}
