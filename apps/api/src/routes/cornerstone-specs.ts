import { cornerstoneSpecs, db, projects } from "@marketing-auto/db";
import { enqueueClusterArticleGeneration } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import {
  checkTriggerAllowed,
  guardErrorToResponse,
} from "./_lib/trigger-helpers.ts";

const log = createLogger("api:cornerstone-specs");

const SPEC_STATUSES = [
  "proposed",
  "approved",
  "in_generation",
  "article_done",
  "rejected",
] as const;

const ListQuerySchema = z.object({
  clusterId: z.string().uuid().optional(),
  status: z.enum(SPEC_STATUSES).optional(),
});

const GenerateArticlesBodySchema = z.object({
  approvalMode: z.enum(["manual", "auto"]).optional(),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

export const cornerstoneSpecRoutes = new Hono();
cornerstoneSpecRoutes.use(requireAuth);

// ─── GET /api/projects/:slug/cornerstone-specs ────────────────────────────────
// Returns specs grouped into translation pairs for the approval UI.
// Query params: clusterId (optional), status (optional)

cornerstoneSpecRoutes.get("/projects/:slug/cornerstone-specs", async (c) => {
  const projectSlug = c.req.param("slug");

  const queryParsed = ListQuerySchema.safeParse(c.req.query());
  if (!queryParsed.success) {
    return c.json({ ok: false, error: "Invalid query params", details: queryParsed.error.flatten() }, 400);
  }
  const { clusterId, status } = queryParsed.data;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions: ReturnType<typeof eq>[] = [eq(cornerstoneSpecs.projectId, project.id)];
  if (clusterId) conditions.push(eq(cornerstoneSpecs.clusterId, clusterId));
  if (status) conditions.push(eq(cornerstoneSpecs.status, status));

  const specs = await db
    .select()
    .from(cornerstoneSpecs)
    .where(and(...conditions))
    .orderBy(desc(cornerstoneSpecs.updatedAt));

  // Group by translationKey to emit DE+EN pairs
  const grouped = new Map<string, typeof specs>();
  for (const s of specs) {
    const arr = grouped.get(s.translationKey) ?? [];
    arr.push(s);
    grouped.set(s.translationKey, arr);
  }

  const pairs = Array.from(grouped.entries()).map(([key, members]) => ({
    translationKey: key,
    clusterId: members[0]!.clusterId,
    de: members.find((m) => m.locale === "de") ?? null,
    en: members.find((m) => m.locale === "en") ?? null,
  }));

  return c.json({ ok: true, data: { pairs, totalSpecs: specs.length } });
});

// ─── POST /api/projects/:slug/cornerstone-specs/:specId/approve ───────────────

cornerstoneSpecRoutes.post("/projects/:slug/cornerstone-specs/:specId/approve", async (c) => {
  const projectSlug = c.req.param("slug");
  const specId = c.req.param("specId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .update(cornerstoneSpecs)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(cornerstoneSpecs.id, specId),
        eq(cornerstoneSpecs.projectId, project.id),
        eq(cornerstoneSpecs.status, "proposed")
      )
    )
    .returning({ id: cornerstoneSpecs.id });

  if (rows.length === 0) {
    return c.json({ ok: false, error: "Spec not found or not in 'proposed' status" }, 400);
  }

  log.info({ specId, projectSlug }, "Cornerstone spec approved");
  return c.json({ ok: true, data: { id: rows[0]!.id, status: "approved" } });
});

// ─── POST /api/projects/:slug/cornerstone-specs/pair/:translationKey/approve ──
// Approves both DE+EN specs of a translation pair at once.

cornerstoneSpecRoutes.post(
  "/projects/:slug/cornerstone-specs/pair/:translationKey/approve",
  async (c) => {
    const projectSlug = c.req.param("slug");
    const translationKey = c.req.param("translationKey");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const updated = await db
      .update(cornerstoneSpecs)
      .set({ status: "approved", updatedAt: new Date() })
      .where(
        and(
          eq(cornerstoneSpecs.translationKey, translationKey),
          eq(cornerstoneSpecs.projectId, project.id),
          eq(cornerstoneSpecs.status, "proposed")
        )
      )
      .returning({ id: cornerstoneSpecs.id, locale: cornerstoneSpecs.locale });

    log.info({ translationKey, projectSlug, count: updated.length }, "Cornerstone pair approved");
    return c.json({ ok: true, data: { approvedCount: updated.length, specs: updated } });
  }
);

// ─── POST /api/projects/:slug/cornerstone-specs/:specId/reject ───────────────

cornerstoneSpecRoutes.post("/projects/:slug/cornerstone-specs/:specId/reject", async (c) => {
  const projectSlug = c.req.param("slug");
  const specId = c.req.param("specId");
  const rawBody = await c.req.json().catch(() => ({}));
  const reason = typeof rawBody.reason === "string" ? rawBody.reason : null;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  // Guard: already-rejected specs keep their original reason (idempotent)
  const rows = await db
    .update(cornerstoneSpecs)
    .set({ status: "rejected", rejectedReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(cornerstoneSpecs.id, specId),
        eq(cornerstoneSpecs.projectId, project.id),
        ne(cornerstoneSpecs.status, "rejected")
      )
    )
    .returning({ id: cornerstoneSpecs.id });

  if (rows.length === 0) return c.json({ ok: false, error: "Spec not found or already rejected" }, 404);

  log.info({ specId, projectSlug, reason }, "Cornerstone spec rejected");
  return c.json({ ok: true, data: { id: rows[0]!.id, status: "rejected" } });
});

// ─── POST /api/projects/:slug/clusters/:clusterId/generate-articles ───────────
// Triggers article generation for all approved specs of a cluster.

cornerstoneSpecRoutes.post(
  "/projects/:slug/clusters/:clusterId/generate-articles",
  async (c) => {
    const projectSlug = c.req.param("slug");
    const clusterId = c.req.param("clusterId");
    const rawBody = await c.req.json().catch(() => ({}));

    const bodyParsed = GenerateArticlesBodySchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return c.json({ ok: false, error: "Invalid body", details: bodyParsed.error.flatten() }, 400);
    }
    const { approvalMode, modelOverride } = bodyParsed.data;

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    // Enforce pause + cost budget before enqueueing article pipeline runs.
    // Cost estimate: ~0.50 EUR per article × 2 locales (conservative).
    // Idempotency is handled per-spec inside enqueueClusterArticleGeneration.
    const blocked = await checkTriggerAllowed({
      pipelineName: "article:outline",
      projectId: project.id,
      uniqueKey: { field: "clusterId", value: clusterId },
      costEstimate: { service: "anthropic", estimatedCostEur: 1.0 },
    });
    if (blocked) return guardErrorToResponse(c, blocked);

    try {
      const enqueueInput: Parameters<typeof enqueueClusterArticleGeneration>[0] = {
        clusterId,
        projectId: project.id,
      };
      if (approvalMode) enqueueInput.approvalMode = approvalMode;
      if (modelOverride) enqueueInput.modelOverride = modelOverride;

      const result = await enqueueClusterArticleGeneration(enqueueInput);
      log.info(
        { clusterId, projectSlug, count: result.results.length },
        "Cluster article generation enqueued"
      );
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, clusterId, projectSlug }, "Cluster article generation failed");
      return c.json({ ok: false, error: msg }, 400);
    }
  }
);
