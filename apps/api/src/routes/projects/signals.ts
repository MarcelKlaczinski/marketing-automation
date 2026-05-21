// Spec 62.3: POST /api/projects/:slug/signals/refresh
//
// Manual trigger for refreshSignalsForProject(). Wires the 5 signal adapter classes
// (producthunt / hackernews / vendor_rss / reddit / github) into the planner's DI
// fetcher callbacks. The planner package itself has zero adapter deps — see
// packages/planner/src/signal-refresh.ts for the rationale (Spec 62.3.5 §2).

import { zValidator } from "@hono/zod-validator";
import { db, eq, projects } from "@marketing-auto/db";
import { refreshSignalsForProject } from "@marketing-auto/planner";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { buildSignalFetcherMap } from "../../lib/signal-fetcher-map.ts";
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
        fetchers: buildSignalFetcherMap(),
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
