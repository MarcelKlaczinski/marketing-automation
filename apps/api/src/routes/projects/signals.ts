// Spec 62.3: POST /api/projects/:slug/signals/refresh
//
// Manual trigger for refreshSignalsForProject(). Wires the 5 signal adapter classes
// (producthunt / hackernews / vendor_rss / reddit / github) into the planner's DI
// fetcher callbacks. The planner package itself has zero adapter deps — see
// packages/planner/src/signal-refresh.ts for the rationale (Spec 62.3.5 §2).

import { zValidator } from "@hono/zod-validator";
import { GitHubSignalSource } from "@marketing-auto/adapter-github-trending";
import { HackerNewsSignalSource } from "@marketing-auto/adapter-hackernews";
import { ProductHuntSignalSource } from "@marketing-auto/adapter-producthunt";
import { RedditSignalSource } from "@marketing-auto/adapter-reddit";
import { VendorRssSignalSource } from "@marketing-auto/adapter-vendor-rss";
import { db, eq, projects } from "@marketing-auto/db";
import {
  refreshSignalsForProject,
  type RefreshableSignal,
  type SignalFetcher,
} from "@marketing-auto/planner";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { readAdapterCreds } from "../../lib/system-service.ts";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("api:signals-refresh");

export const signalsRefreshRoutes = new Hono();
signalsRefreshRoutes.use(requireAuth);

const bodySchema = z.object({
  force: z.boolean().optional(),
});

signalsRefreshRoutes.post(
  "/:slug/signals/refresh",
  zValidator(
    "json",
    bodySchema,
    (result, c) => (result.success ? undefined : c.json({ ok: false, error: result.error.message }, 400)),
  ),
  async (c) => {
    const slug = c.req.param("slug");
    if (!slug) {
      return c.json({ ok: false, error: "missing :slug param" }, 400);
    }

    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!proj) {
      return c.json({ ok: false, error: `project not found: ${slug}` }, 404);
    }

    // Optional body — handle Content-Type-less calls per CLAUDE.md "Optional-Body POST Endpoints"
    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    const force = parsed.success ? parsed.data.force ?? false : false;

    try {
      const result = await refreshSignalsForProject({
        projectId: proj.id,
        force,
        fetchers: buildFetcherMap(),
        readCreds: readAdapterCreds,
      });
      return c.json({ ok: true, data: result });
    } catch (err) {
      log.error({ err, projectId: proj.id }, "signals refresh failed");
      const message = err instanceof Error ? err.message : "internal error";
      return c.json({ ok: false, error: message }, 500);
    }
  },
);

// ─── Adapter wiring ───────────────────────────────────────────────────────────
//
// One fetcher per source. The planner orchestrator handles per-source staleness,
// error containment, persistence, and status mapping. Each fetcher's job is to
// instantiate the adapter, pull config + creds from the planner-provided context,
// and return RawSignal[] (or throw a "credentials not configured" error).

function buildFetcherMap(): Record<string, SignalFetcher> {
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
      const activeFeeds = signalSources.vendor_rss.feeds.filter((f) => f.enabled).map((f) => f.url);
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
        throw new Error("reddit: client_id, client_secret, and user_agent credentials not configured");
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
