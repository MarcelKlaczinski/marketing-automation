import { zValidator } from "@hono/zod-validator";
import {
  and,
  db,
  eq,
  projectConfigurations,
  projects,
  SignalSourcesSchema,
  type VendorRssFeed,
} from "@marketing-auto/db";
import { loadActiveConfig, clearConfigCache } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { verifyRssFeed } from "@marketing-auto/adapter-vendor-rss/verify";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { getSignalCollectorQueue } from "../../workers/signal-collector.ts";

const log = createLogger("api:signal-sources-routes");

export const signalSourcesRoutes = new Hono();
signalSourcesRoutes.use(requireAuth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadProjectAndConfig(slug: string) {
  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!proj) return null;
  const config = await loadActiveConfig(proj.id);
  return { proj, config };
}

async function updateVendorRssFeeds(
  projectId: string,
  feeds: VendorRssFeed[],
): Promise<void> {
  const [active] = await db
    .select({ id: projectConfigurations.id, signalSources: projectConfigurations.signalSources })
    .from(projectConfigurations)
    .where(
      and(
        eq(projectConfigurations.projectId, projectId),
        eq(projectConfigurations.status, "active"),
      ),
    )
    .limit(1);
  if (!active) throw new Error(`No active config for project ${projectId}`);

  const updated: typeof active.signalSources = {
    ...active.signalSources,
    vendor_rss: {
      ...active.signalSources.vendor_rss,
      feeds,
    },
  };

  await db
    .update(projectConfigurations)
    .set({ signalSources: updated })
    .where(eq(projectConfigurations.id, active.id));

  clearConfigCache(projectId);
}

async function updateSourceConfig(
  projectId: string,
  source: string,
  partial: Record<string, unknown>,
): Promise<void> {
  const [active] = await db
    .select({ id: projectConfigurations.id, signalSources: projectConfigurations.signalSources })
    .from(projectConfigurations)
    .where(
      and(
        eq(projectConfigurations.projectId, projectId),
        eq(projectConfigurations.status, "active"),
      ),
    )
    .limit(1);
  if (!active) throw new Error(`No active config for project ${projectId}`);

  const currentSources = active.signalSources as Record<string, unknown>;
  const currentSource = currentSources[source] ?? {};

  // producthunt is stored as a plain boolean in SignalSourcesSchema — extracting enabled directly
  const nextValue =
    source === "producthunt"
      ? typeof partial.enabled === "boolean"
        ? partial.enabled
        : (currentSource as boolean)
      : typeof currentSource === "object" && currentSource !== null
        ? { ...(currentSource as Record<string, unknown>), ...partial }
        : partial;

  const updated = SignalSourcesSchema.parse({
    ...currentSources,
    [source]: nextValue,
  });

  await db
    .update(projectConfigurations)
    .set({ signalSources: updated })
    .where(eq(projectConfigurations.id, active.id));

  clearConfigCache(projectId);
}

// ─── GET signal sources config ───────────────────────────────────────────────

signalSourcesRoutes.get("/:slug/signal-sources", async (c) => {
  const slug = c.req.param("slug");
  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  return c.json({ ok: true, data: ctx.config.signalSources });
});

// ─── A.3 Vendor-RSS Feed CRUD ────────────────────────────────────────────────

const addFeedSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1).max(100),
});

signalSourcesRoutes.post("/:slug/signal-sources/vendor-rss/feeds", zValidator("json", addFeedSchema), async (c) => {
  const slug = c.req.param("slug");
  const input = c.req.valid("json");

  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  const { proj, config } = ctx;

  const existing = config.signalSources.vendor_rss.feeds.find((f) => f.url === input.url);
  if (existing) return c.json({ ok: false, error: "feed_already_exists" }, 409);

  const verifyResult = await verifyRssFeed(input.url);
  if (!verifyResult.ok) {
    return c.json({ ok: false, error: "feed_verification_failed", message: verifyResult.error }, 422);
  }

  const newFeed: VendorRssFeed = {
    id: crypto.randomUUID(),
    url: input.url,
    label: input.label,
    enabled: true,
    addedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
  };

  const updatedFeeds = [...config.signalSources.vendor_rss.feeds, newFeed];
  await updateVendorRssFeeds(proj.id, updatedFeeds);

  log.info({ projectId: proj.id, feedId: newFeed.id }, "vendor-rss feed added");
  return c.json({ ok: true, data: { feed: newFeed } }, 201);
});

const updateFeedSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((d) => d.label !== undefined || d.enabled !== undefined, {
    message: "At least one of label or enabled must be provided",
  });

signalSourcesRoutes.patch("/:slug/signal-sources/vendor-rss/feeds/:feedId", zValidator("json", updateFeedSchema), async (c) => {
  const slug = c.req.param("slug");
  const feedId = c.req.param("feedId");
  const input = c.req.valid("json");

  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  const { proj, config } = ctx;

  const feedIndex = config.signalSources.vendor_rss.feeds.findIndex((f) => f.id === feedId);
  const existing = config.signalSources.vendor_rss.feeds[feedIndex];
  if (feedIndex === -1 || !existing) return c.json({ ok: false, error: "feed_not_found" }, 404);
  const updatedFeed: VendorRssFeed = {
    id: existing.id,
    url: existing.url,
    addedAt: existing.addedAt,
    lastVerifiedAt: existing.lastVerifiedAt,
    label: input.label !== undefined ? input.label : existing.label,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
  };

  const updatedFeeds = [...config.signalSources.vendor_rss.feeds];
  updatedFeeds[feedIndex] = updatedFeed;
  await updateVendorRssFeeds(proj.id, updatedFeeds);

  return c.json({ ok: true, data: { feed: updatedFeed } });
});

signalSourcesRoutes.delete("/:slug/signal-sources/vendor-rss/feeds/:feedId", async (c) => {
  const slug = c.req.param("slug");
  const feedId = c.req.param("feedId");

  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  const { proj, config } = ctx;

  const exists = config.signalSources.vendor_rss.feeds.some((f) => f.id === feedId);
  if (!exists) return c.json({ ok: false, error: "feed_not_found" }, 404);

  const updatedFeeds = config.signalSources.vendor_rss.feeds.filter((f) => f.id !== feedId);
  await updateVendorRssFeeds(proj.id, updatedFeeds);

  log.info({ projectId: proj.id, feedId }, "vendor-rss feed deleted");
  return c.json({ ok: true });
});

// ─── A.4 Per-Source Operational Config ───────────────────────────────────────

const validSources = ["reddit", "github", "hackernews", "producthunt", "vendor_rss"] as const;
type SignalSource = (typeof validSources)[number];

const redditConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  subreddits: z.array(z.string()).optional(),
  sortMode: z.enum(["top", "hot", "new"]).optional(),
  timeWindow: z.enum(["day", "week", "month"]).optional(),
  minUpvotes: z.number().int().min(0).optional(),
  minComments: z.number().int().min(0).optional(),
  maxAgeDays: z.number().int().min(1).optional(),
  cronPattern: z.string().optional(),
});

const githubConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
  timeWindowDays: z.number().int().min(1).optional(),
  minStarsNew: z.number().int().min(0).optional(),
  minStarsEstablished: z.number().int().min(0).optional(),
  maxAgeDays: z.number().int().min(1).optional(),
  cronPattern: z.string().optional(),
});

const hackernewsConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  queries: z.array(z.string()).optional(),
  hitsPerPage: z.number().int().min(1).max(200).optional(),
  minPoints: z.number().int().min(0).optional(),
});

const producthuntConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
});

const vendorRssConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
});

const sourceConfigPatchSchemas: Record<SignalSource, z.ZodTypeAny> = {
  reddit: redditConfigPatchSchema,
  github: githubConfigPatchSchema,
  hackernews: hackernewsConfigPatchSchema,
  producthunt: producthuntConfigPatchSchema,
  vendor_rss: vendorRssConfigPatchSchema,
};

signalSourcesRoutes.patch("/:slug/signal-sources/:source", async (c) => {
  const slug = c.req.param("slug");
  const source = c.req.param("source");

  if (!(validSources as readonly string[]).includes(source)) {
    return c.json({ ok: false, error: "invalid_source" }, 400);
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const schema = sourceConfigPatchSchemas[source as SignalSource];
  const parseResult = schema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ ok: false, error: "invalid_body", details: parseResult.error.flatten() }, 400);
  }

  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  const { proj } = ctx;

  // safe: Zod validated shape matches partial config; cast resolves variance mismatch
  await updateSourceConfig(proj.id, source, parseResult.data as Record<string, unknown>);

  log.info({ projectId: proj.id, source }, "signal source config updated");
  return c.json({ ok: true });
});

// ─── A.5 Manual Trigger ───────────────────────────────────────────────────────

signalSourcesRoutes.post("/:slug/signal-sources/:source/trigger", async (c) => {
  const slug = c.req.param("slug");
  const source = c.req.param("source");

  if (!(validSources as readonly string[]).includes(source)) {
    return c.json({ ok: false, error: "invalid_source" }, 400);
  }

  const ctx = await loadProjectAndConfig(slug);
  if (!ctx) return c.json({ ok: false, error: "project_not_found" }, 404);
  const { proj } = ctx;

  const jobId = `manual-${source}-${proj.id}-${Date.now()}`;
  const queue = getSignalCollectorQueue();
  await queue.add(
    "collect-adapter",
    { type: "collect-adapter", projectId: proj.id, adapter: source as SignalSource },
    { jobId, attempts: 1 },
  );

  log.info({ projectId: proj.id, source: source as SignalSource, jobId }, "manual signal collection triggered");
  return c.json({ ok: true, data: { jobId } }, 202);
});
