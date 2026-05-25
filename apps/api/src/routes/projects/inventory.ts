// Spec 64.20: HTTP routes for `content_source_inventory` CRUD + refresh trigger.
//
// All routes are under `/api/projects/:slug/inventory` and require auth.
// Mount via `app.route("/api/projects", inventoryRoutes)` in `server.ts`.

import { zValidator } from "@hono/zod-validator";
import {
  and,
  contentSourceInventory,
  ContentSourceInventoryPatchSchema,
  countByObjectType,
  createInventoryRow,
  cronState,
  db,
  eq,
  getInventoryById,
  hardDeleteInventoryRow,
  inArray,
  INVENTORY_FETCH_STATUSES,
  INVENTORY_OBJECT_TYPES,
  isNotNull,
  isNull,
  listInventoryByProject,
  patchInventoryRow,
  projects,
  type InventoryFetchStatus,
  type InventoryObjectType,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import {
  getGithubInventoryQueue,
  GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN,
} from "../../workers/github-inventory-refresh.worker.ts";
import {
  getGithubInventoryDiscoveryQueue,
  GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN,
} from "../../workers/github-inventory-discovery.worker.ts";
import { syncCronJobs } from "../../workers/cron-orchestrator.ts";

const log = createLogger("api:inventory-routes");

export const inventoryRoutes = new Hono();
inventoryRoutes.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadProjectBySlug(slug: string) {
  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

/**
 * Cross-tenant guard: confirm the inventory row belongs to the given project.
 * Returns the row on match, null on mismatch / not-found.
 */
async function loadInventoryForProject(id: string, projectId: string) {
  const row = await getInventoryById(id);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

// ─── GET /:slug/inventory ───────────────────────────────────────────────────

inventoryRoutes.get("/:slug/inventory", async (c) => {
  const slug = c.req.param("slug");
  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const objectTypeParam = c.req.query("objectType");
  const fetchStatusParam = c.req.query("fetchStatus");
  const approvedOnlyParam = c.req.query("approvedOnly");

  const objectType: InventoryObjectType | undefined =
    objectTypeParam && (INVENTORY_OBJECT_TYPES as readonly string[]).includes(objectTypeParam)
      ? (objectTypeParam as InventoryObjectType)
      : undefined;
  const fetchStatus: InventoryFetchStatus | undefined =
    fetchStatusParam && (INVENTORY_FETCH_STATUSES as readonly string[]).includes(fetchStatusParam)
      ? (fetchStatusParam as InventoryFetchStatus)
      : undefined;

  const rows = await listInventoryByProject({
    projectId: proj.id,
    ...(objectType !== undefined && { objectType }),
    ...(fetchStatus !== undefined && { fetchStatus }),
    approvedOnly: approvedOnlyParam !== "false",
  });
  const counts = await countByObjectType(proj.id);

  return c.json({ ok: true, data: { items: rows, counts } });
});

// ─── POST /:slug/inventory — create row ─────────────────────────────────────

// Body schema: same as the DB Zod schema MINUS server-managed fields.
// Marcel-Seed inserts pre-approve via `approveOnCreate: true`; otherwise
// rows land with `approved_at = NULL` (placeholder for V1.1 Auto-Discovery).
const createBodySchema = z.object({
  source: z.enum(["github"]).default("github"),
  objectType: z.enum(INVENTORY_OBJECT_TYPES),
  sourceIdentifier: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  homepageUrl: z.string().url().max(500).nullable().optional(),
  refreshIntervalHours: z.number().int().min(1).max(8760).default(168),
  articleId: z.string().uuid().nullable().optional(),
  approveOnCreate: z.boolean().default(true),
});

inventoryRoutes.post(
  "/:slug/inventory",
  zValidator("json", createBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const user = c.var.user;

    try {
      const row = await createInventoryRow({
        projectId: proj.id,
        source: body.source,
        objectType: body.objectType,
        sourceIdentifier: body.sourceIdentifier,
        displayName: body.displayName,
        ...(body.description !== undefined && { description: body.description }),
        ...(body.homepageUrl !== undefined && { homepageUrl: body.homepageUrl }),
        refreshIntervalHours: body.refreshIntervalHours,
        ...(body.articleId !== undefined && { articleId: body.articleId }),
        ...(body.approveOnCreate && {
          approvedAt: new Date(),
          approvedByUserId: user?.id ?? null,
        }),
      });
      return c.json({ ok: true, data: row }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("collection=")) {
        // Article-link rule violation from `assertArticleCollectionForTool`
        return c.json({ ok: false, error: "article_collection_mismatch", message }, 422);
      }
      // Unique-constraint violation (duplicate source_identifier among approved rows)
      if (message.includes("csi_project_source_identifier_approved_unique")) {
        return c.json({ ok: false, error: "source_identifier_already_exists" }, 409);
      }
      log.error({ err, slug, body }, "createInventoryRow failed");
      throw err;
    }
  },
);

// ─── A2 Tranche 2 — cron-status read + toggle ──────────────────────────────
//
// Registered BEFORE `/:slug/inventory/:id` so Hono's trie router matches
// "/cron-status" as a literal segment instead of `:id="cron-status"` (the
// 2-segment-after-inventory case where the trie router cannot disambiguate
// from registration order alone — see root CLAUDE.md "Specific named paths
// before wildcard params").

type InventoryJobType = "github_inventory_refresh" | "github_inventory_discovery";
const INVENTORY_JOB_TYPES_MUTABLE: InventoryJobType[] = [
  "github_inventory_refresh",
  "github_inventory_discovery",
];

function defaultPatternFor(jobType: InventoryJobType): string {
  return jobType === "github_inventory_refresh"
    ? GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN
    : GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN;
}

// GET /:slug/inventory/cron-status — returns BOTH refresh + discovery
//   crons in a single response (matches the SettingsPage UI pattern that
//   shows both in one section).
inventoryRoutes.get("/:slug/inventory/cron-status", async (c) => {
  const slug = c.req.param("slug");
  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .select()
    .from(cronState)
    .where(
      and(
        eq(cronState.projectId, proj.id),
        inArray(cronState.jobType, INVENTORY_JOB_TYPES_MUTABLE),
      ),
    );
  const byType = Object.fromEntries(rows.map((r) => [r.jobType, r]));

  const format = (jobType: InventoryJobType) => {
    const row = byType[jobType];
    return {
      isActive:      row?.isActive ?? (jobType === "github_inventory_refresh"),
      cronPattern:   row?.cronPattern ?? defaultPatternFor(jobType),
      lastRunAt:     row?.lastRunAt?.toISOString() ?? null,
      lastRunStatus: row?.lastRunStatus ?? null,
      lastRunError:  row?.lastRunError ?? null,
      nextRunAt:     row?.nextRunAt?.toISOString() ?? null,
    };
  };

  return c.json({
    ok: true,
    data: {
      refresh:   format("github_inventory_refresh"),
      discovery: format("github_inventory_discovery"),
    },
  });
});

const patchCronStatusSchema = z.object({
  jobType:     z.enum(["github_inventory_refresh", "github_inventory_discovery"]),
  isActive:    z.boolean(),
  cronPattern: z.string().regex(/^[\d*\/,\-\s]+$/).optional(),
});

// PATCH /:slug/inventory/cron-status — upserts the cron_state row and
//   fires syncCronJobs() in background so the orchestrator picks up the
//   change immediately rather than at the next 1-minute tick.
inventoryRoutes.patch(
  "/:slug/inventory/cron-status",
  zValidator("json", patchCronStatusSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const cronPattern = body.cronPattern ?? defaultPatternFor(body.jobType);

    await db
      .insert(cronState)
      .values({
        projectId:   proj.id,
        jobType:     body.jobType,
        isActive:    body.isActive,
        cronPattern,
      })
      .onConflictDoUpdate({
        target: [cronState.projectId, cronState.jobType],
        set: {
          isActive: body.isActive,
          cronPattern,
          updatedAt: new Date(),
        },
      });

    // Background sync — don't block the response. Failure is non-fatal: the
    // orchestrator's next 1-minute tick will pick up the change anyway.
    syncCronJobs().catch((err) => {
      log.warn({ err, slug, jobType: body.jobType }, "Background cron sync failed after PATCH");
    });

    return c.json({ ok: true, data: { jobType: body.jobType, isActive: body.isActive, cronPattern } });
  },
);

// ─── PATCH /:slug/inventory/:id ─────────────────────────────────────────────

inventoryRoutes.patch(
  "/:slug/inventory/:id",
  zValidator("json", ContentSourceInventoryPatchSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");

    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const row = await loadInventoryForProject(id, proj.id);
    if (!row) return c.json({ ok: false, error: "inventory_row_not_found" }, 404);

    const body = c.req.valid("json");
    try {
      const updated = await patchInventoryRow(id, body);
      if (!updated) {
        return c.json({ ok: true, data: row, noop: true });
      }
      return c.json({ ok: true, data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("collection=")) {
        return c.json({ ok: false, error: "article_collection_mismatch", message }, 422);
      }
      log.error({ err, id, body }, "patchInventoryRow failed");
      throw err;
    }
  },
);

// ─── DELETE /:slug/inventory/:id ────────────────────────────────────────────

inventoryRoutes.delete("/:slug/inventory/:id", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");

  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const row = await loadInventoryForProject(id, proj.id);
  if (!row) return c.json({ ok: false, error: "inventory_row_not_found" }, 404);

  const deleted = await hardDeleteInventoryRow(id);
  return c.json({ ok: true, data: { deleted } });
});

// ─── POST /:slug/inventory/refresh — bulk trigger ──────────────────────────

const refreshBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100).optional(),
});

inventoryRoutes.post(
  "/:slug/inventory/refresh",
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    // Optional body — empty body means "refresh all due-now".
    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = refreshBodySchema.safeParse(rawBody);
    const body = parsed.success ? parsed.data : {};

    const queue = getGithubInventoryQueue();
    const jobId = `inventory-refresh-${proj.id}-${Date.now()}`;
    await queue.add(
      body.ids?.length ? "refresh-manual" : "cron-triggered",
      {
        projectId: proj.id,
        type: body.ids?.length ? "refresh-manual" : "cron-triggered",
        ...(body.ids !== undefined && { ids: body.ids }),
      },
      { jobId, removeOnComplete: 50, removeOnFail: 50 },
    );

    return c.json({
      ok: true,
      data: { jobId, mode: body.ids?.length ? "manual" : "due-now" },
    });
  },
);

// ─── POST /:slug/inventory/:id/refresh — per-row trigger ──────────────────

inventoryRoutes.post("/:slug/inventory/:id/refresh", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");

  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const row = await loadInventoryForProject(id, proj.id);
  if (!row) return c.json({ ok: false, error: "inventory_row_not_found" }, 404);

  const queue = getGithubInventoryQueue();
  const jobId = `inventory-refresh-${proj.id}-${id}-${Date.now()}`;
  await queue.add(
    "refresh-manual",
    { projectId: proj.id, type: "refresh-manual", ids: [id] },
    { jobId, removeOnComplete: 50, removeOnFail: 50 },
  );

  return c.json({ ok: true, data: { jobId } });
});

// ─── A2 Auto-Discovery (Spec 64.20 follow-up A2) ───────────────────────────

// POST /:slug/inventory/discovery/run — manual trigger of the discovery cron
//   for ad-hoc runs (e.g. Marcel just curated the seed list + wants to see
//   what Auto-Discovery surfaces immediately, not next Sunday).
inventoryRoutes.post("/:slug/inventory/discovery/run", async (c) => {
  const slug = c.req.param("slug");
  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const queue = getGithubInventoryDiscoveryQueue();
  const jobId = `inventory-discovery-${proj.id}-${Date.now()}`;
  await queue.add(
    "manual",
    { projectId: proj.id, type: "manual" },
    { jobId, removeOnComplete: 50, removeOnFail: 50 },
  );

  return c.json({ ok: true, data: { jobId } });
});

// ─── A2 Tranche 2 — bulk approve / reject ──────────────────────────────────
//
// Registered BEFORE `/:slug/inventory/:id/approve` so Hono's trie router
// matches "/discovery/approve" as two literal segments instead of
// `:id="discovery"`. Same registration-order constraint as cron-status above.

const bulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

// POST /:slug/inventory/discovery/approve — flip approved_at on N rows.
//   Only matches rows scoped to this project + currently unapproved.
//   Returns counts of {approved, alreadyApproved, notFound}.
inventoryRoutes.post(
  "/:slug/inventory/discovery/approve",
  zValidator("json", bulkIdsSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { ids } = c.req.valid("json");
    const user = c.var.user;

    // Snapshot which rows in scope are already approved BEFORE the UPDATE —
    // querying after would include the rows the UPDATE just flipped, double-
    // counting them.
    const alreadyApprovedRows = await db
      .select({ id: contentSourceInventory.id })
      .from(contentSourceInventory)
      .where(
        and(
          eq(contentSourceInventory.projectId, proj.id),
          inArray(contentSourceInventory.id, ids),
          isNotNull(contentSourceInventory.approvedAt),
        ),
      );

    // Update only rows that belong to this project + still unapproved.
    const updated = await db
      .update(contentSourceInventory)
      .set({
        approvedAt:       new Date(),
        approvedByUserId: user?.id ?? null,
        updatedAt:        new Date(),
      })
      .where(
        and(
          eq(contentSourceInventory.projectId, proj.id),
          inArray(contentSourceInventory.id, ids),
          isNull(contentSourceInventory.approvedAt),
        ),
      )
      .returning({ id: contentSourceInventory.id });

    const approved = updated.length;
    const alreadyApproved = alreadyApprovedRows.length;
    const notFound = ids.length - approved - alreadyApproved;

    log.info(
      { slug, requested: ids.length, approved, alreadyApproved, notFound },
      "Bulk approve completed",
    );

    return c.json({
      ok: true,
      data: { approved, alreadyApproved, notFound },
    });
  },
);

// POST /:slug/inventory/discovery/reject — hard-delete unapproved rows.
//   Approved rows are skipped (Marcel must softDelete those via the main
//   DELETE route instead — different intent).
inventoryRoutes.post(
  "/:slug/inventory/discovery/reject",
  zValidator("json", bulkIdsSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await loadProjectBySlug(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { ids } = c.req.valid("json");

    const deleted = await db
      .delete(contentSourceInventory)
      .where(
        and(
          eq(contentSourceInventory.projectId, proj.id),
          inArray(contentSourceInventory.id, ids),
          isNull(contentSourceInventory.approvedAt),
        ),
      )
      .returning({ id: contentSourceInventory.id });

    log.info(
      { slug, requested: ids.length, deleted: deleted.length },
      "Bulk reject completed",
    );

    return c.json({
      ok: true,
      data: { rejected: deleted.length, skipped: ids.length - deleted.length },
    });
  },
);

// POST /:slug/inventory/:id/approve — flip approved_at on a discovery
//   candidate (an unapproved row from Auto-Discovery). Sets approved_at = NOW
//   and approved_by_user_id = current user. Idempotent — re-approving a
//   row that's already approved is a no-op.
inventoryRoutes.post("/:slug/inventory/:id/approve", async (c) => {
  const slug = c.req.param("slug");
  const id = c.req.param("id");
  const user = c.var.user;

  const proj = await loadProjectBySlug(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const row = await loadInventoryForProject(id, proj.id);
  if (!row) return c.json({ ok: false, error: "inventory_row_not_found" }, 404);

  if (row.approvedAt !== null) {
    return c.json({ ok: true, data: row, alreadyApproved: true });
  }

  const patched = await patchInventoryRow(id, {});
  // patchInventoryRow returns null on empty patch — instead we run a
  // dedicated UPDATE to set approval fields atomically.
  void patched;

  const rows = await db
    .update(contentSourceInventory)
    .set({
      approvedAt: new Date(),
      approvedByUserId: user?.id ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentSourceInventory.id, id),
        isNull(contentSourceInventory.approvedAt),
      ),
    )
    .returning();

  return c.json({ ok: true, data: rows[0] ?? row });
});


