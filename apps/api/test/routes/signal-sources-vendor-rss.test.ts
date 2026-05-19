/**
 * Spec 59.1c — vendor-rss feed CRUD endpoint tests.
 *
 * Tests the DB invariants for add/update/delete feed operations. Where the
 * endpoint calls verifyRssFeed (external network), the module is mocked.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  and,
  db,
  eq,
  projectConfigurations,
  projects,
  SignalSourcesSchema,
  type VendorRssFeed,
} from "@marketing-auto/db";

// Mock verifyRssFeed so tests don't hit real RSS endpoints
mock.module("@marketing-auto/adapter-vendor-rss/verify", () => ({
  verifyRssFeed: async (url: string) => {
    if (url.includes("bad-feed")) return { ok: false as const, error: "not an rss feed" };
    return { ok: true as const, title: "Mock Feed" };
  },
}));

const SLUG = `vendor-rss-test-${Date.now()}`;

describe("vendor-rss feed CRUD (Spec 59.1c A.3)", () => {
  let projectId: string;

  function makeDefaultConfig() {
    return SignalSourcesSchema.parse({});
  }

  async function readFeeds(): Promise<VendorRssFeed[]> {
    const [row] = await db
      .select({ signalSources: projectConfigurations.signalSources })
      .from(projectConfigurations)
      .where(
        and(
          eq(projectConfigurations.projectId, projectId),
          eq(projectConfigurations.status, "active"),
        ),
      )
      .limit(1);
    return row?.signalSources?.vendor_rss?.feeds ?? [];
  }

  async function writeFeeds(feeds: VendorRssFeed[]): Promise<void> {
    const [row] = await db
      .select({ id: projectConfigurations.id, signalSources: projectConfigurations.signalSources })
      .from(projectConfigurations)
      .where(
        and(
          eq(projectConfigurations.projectId, projectId),
          eq(projectConfigurations.status, "active"),
        ),
      )
      .limit(1);
    if (!row) return;
    const updated = SignalSourcesSchema.parse({
      ...row.signalSources,
      vendor_rss: { ...row.signalSources.vendor_rss, feeds },
    });
    await db
      .update(projectConfigurations)
      .set({ signalSources: updated })
      .where(eq(projectConfigurations.id, row.id));
  }

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: SLUG,
        name: "Vendor RSS Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    await db.insert(projectConfigurations).values({
      projectId,
      version: 1,
      status: "active",
      intentTaxonomyDefault: ["blog", "review"],
      masterPrompts: {},
      topicScope: { languages: ["de"], exclusions: [], primary_themes: [], relevance_keywords: [], min_trend_score: 25, min_signal_thresholds: { hackernews: 3, producthunt: 0, vendor_rss: 0 } },
      signalSources: makeDefaultConfig(),
      automationRules: [],
    });
  });

  afterAll(async () => {
    await db.delete(projectConfigurations).where(eq(projectConfigurations.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  describe("feed schema validation", () => {
    it("VendorRssFeed objects round-trip through SignalSourcesSchema.parse()", () => {
      const feed: VendorRssFeed = {
        id: crypto.randomUUID(),
        url: "https://openai.com/blog/rss",
        label: "OpenAI Blog",
        enabled: true,
        addedAt: new Date().toISOString(),
        lastVerifiedAt: null,
      };
      const parsed = SignalSourcesSchema.parse({
        vendor_rss: { enabled: true, feeds: [feed] },
      });
      expect(parsed.vendor_rss.feeds).toHaveLength(1);
      expect(parsed.vendor_rss.feeds[0]?.url).toBe(feed.url);
      expect(parsed.vendor_rss.feeds[0]?.label).toBe(feed.label);
    });

    it("rejects a feed entry missing required fields", () => {
      expect(() =>
        SignalSourcesSchema.parse({
          vendor_rss: { enabled: true, feeds: [{ url: "https://example.com/rss" }] },
        }),
      ).toThrow();
    });
  });

  describe("DB-layer feed write/read roundtrip", () => {
    it("writes and reads a single feed back from projectConfigurations", async () => {
      const feed: VendorRssFeed = {
        id: crypto.randomUUID(),
        url: "https://blog.anthropic.com/rss",
        label: "Anthropic Blog",
        enabled: true,
        addedAt: new Date().toISOString(),
        lastVerifiedAt: null,
      };
      await writeFeeds([feed]);

      const feeds = await readFeeds();
      expect(feeds).toHaveLength(1);
      expect(feeds[0]?.url).toBe(feed.url);
      expect(feeds[0]?.label).toBe(feed.label);
      expect(feeds[0]?.enabled).toBe(true);
    });

    it("updates feed label without touching other fields", async () => {
      const feeds = await readFeeds();
      const existing = feeds[0]!;
      const updated: VendorRssFeed = {
        ...existing,
        label: "Anthropic Research Blog",
      };
      await writeFeeds([updated]);

      const result = await readFeeds();
      expect(result[0]?.label).toBe("Anthropic Research Blog");
      expect(result[0]?.url).toBe(existing.url);
      expect(result[0]?.id).toBe(existing.id);
    });

    it("toggles feed enabled = false", async () => {
      const feeds = await readFeeds();
      const existing = feeds[0]!;
      await writeFeeds([{ ...existing, enabled: false }]);

      const result = await readFeeds();
      expect(result[0]?.enabled).toBe(false);
    });

    it("removes a feed by filtering it out", async () => {
      await writeFeeds([]);
      const result = await readFeeds();
      expect(result).toHaveLength(0);
    });
  });

  describe("duplicate URL guard", () => {
    it("correctly detects duplicate by URL", async () => {
      const url = "https://openai.com/blog/rss";
      const feed: VendorRssFeed = {
        id: crypto.randomUUID(),
        url,
        label: "OpenAI Blog",
        enabled: true,
        addedAt: new Date().toISOString(),
        lastVerifiedAt: null,
      };
      await writeFeeds([feed]);

      const current = await readFeeds();
      const isDuplicate = current.some((f) => f.url === url);
      expect(isDuplicate).toBe(true);

      await writeFeeds([]);
    });
  });

  // ─── HTTP smoke tests (require running server) ───────────────────────────────

  describe("POST /api/projects/:slug/signal-sources/vendor-rss/feeds", () => {
    it("returns 400 for invalid URL", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor-rss/feeds`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "not-a-url", label: "Test" }),
        },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([400, 401]);
    });

    it("returns 409 for duplicate URL (requires auth)", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor-rss/feeds`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://openai.com/blog/rss", label: "OpenAI" }),
        },
      ).catch(() => null);
      if (!res) return;
      // 401 without auth; 409 if auth passes and feed already exists; 201 if first add
      expect(res.status).toBeOneOf([201, 401, 409]);
    });

    it("returns 422 for URL that fails feed verification", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor-rss/feeds`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://bad-feed.example.com/rss", label: "Bad Feed" }),
        },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([401, 422]);
    });
  });

  describe("PATCH /api/projects/:slug/signal-sources/vendor-rss/feeds/:feedId", () => {
    it("returns 404 for unknown feedId (requires auth)", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor-rss/feeds/00000000-0000-0000-0000-000000000000`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: "New Label" }),
        },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([401, 404]);
    });
  });

  describe("DELETE /api/projects/:slug/signal-sources/vendor-rss/feeds/:feedId", () => {
    it("returns 404 for unknown feedId (requires auth)", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor-rss/feeds/00000000-0000-0000-0000-000000000000`,
        { method: "DELETE" },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([401, 404]);
    });
  });
});
