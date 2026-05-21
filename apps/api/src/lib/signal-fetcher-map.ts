// Spec 62.4: shared signal-adapter fetcher map.
//
// Originally inlined in `apps/api/src/routes/projects/signals.ts` (Spec 62.3).
// Extracted so the PlanWeekPipeline worker can reuse the same wiring at
// pipeline-register time without duplicating adapter imports.

import { GitHubSignalSource } from "@marketing-auto/adapter-github-trending";
import { HackerNewsSignalSource } from "@marketing-auto/adapter-hackernews";
import { ProductHuntSignalSource } from "@marketing-auto/adapter-producthunt";
import { RedditSignalSource } from "@marketing-auto/adapter-reddit";
import { VendorRssSignalSource } from "@marketing-auto/adapter-vendor-rss";
import type { RefreshableSignal, SignalFetcher } from "@marketing-auto/planner";

export function buildSignalFetcherMap(): Record<string, SignalFetcher> {
  return {
    producthunt: async ({ projectId, readCreds }) => {
      const creds = await readCreds("producthunt");
      if (!creds.api_key || !creds.api_secret) {
        throw new Error("producthunt api_key and api_secret credentials not configured");
      }
      const signals = await new ProductHuntSignalSource(creds.api_key, creds.api_secret).fetch(
        {} as never,
        { projectId },
      );
      return signals as RefreshableSignal[];
    },
    hackernews: async ({ projectId, signalSources }) => {
      const hn = signalSources.hackernews;
      const signals = await new HackerNewsSignalSource().fetch(
        {
          queries: hn.queries,
          hitsPerPage: hn.hitsPerPage,
          minPoints: hn.minPoints,
          maxAgeDays: 30,
        },
        { projectId },
      );
      return signals as RefreshableSignal[];
    },
    vendor_rss: async ({ projectId, signalSources }) => {
      const activeFeeds = signalSources.vendor_rss.feeds
        .filter((f) => f.enabled)
        .map((f) => f.url);
      if (activeFeeds.length === 0) {
        return [];
      }
      const signals = await new VendorRssSignalSource().fetch(
        { feeds: activeFeeds, maxAgeDays: 14 },
        { projectId },
      );
      return signals as RefreshableSignal[];
    },
    reddit: async ({ projectId, signalSources, readCreds }) => {
      const cfg = signalSources.reddit;
      const creds = await readCreds("reddit");
      if (!creds.client_id || !creds.client_secret || !creds.user_agent) {
        throw new Error(
          "reddit: client_id, client_secret, and user_agent credentials not configured",
        );
      }
      const signals = await new RedditSignalSource().fetch(
        {
          subreddits: cfg.subreddits,
          sortMode: cfg.sortMode,
          timeWindow: cfg.timeWindow,
          minUpvotes: cfg.minUpvotes,
          minComments: cfg.minComments,
          maxAgeDays: cfg.maxAgeDays,
          limit: 100,
          credentials: {
            clientId: creds.client_id,
            clientSecret: creds.client_secret,
            userAgent: creds.user_agent,
          },
        },
        { projectId },
      );
      return signals as RefreshableSignal[];
    },
    github: async ({ projectId, signalSources, readCreds }) => {
      const cfg = signalSources.github;
      const creds = await readCreds("github");
      if (!creds.personal_access_token) {
        throw new Error("github: personal_access_token credential not configured");
      }
      const signals = await new GitHubSignalSource().fetch(
        {
          topics: cfg.topics,
          timeWindowDays: cfg.timeWindowDays,
          minStarsNew: cfg.minStarsNew,
          minStarsEstablished: cfg.minStarsEstablished,
          maxAgeDays: cfg.maxAgeDays,
          perQueryLimit: 30,
          credentials: { personalAccessToken: creds.personal_access_token },
        },
        { projectId },
      );
      return signals as RefreshableSignal[];
    },
  };
}
