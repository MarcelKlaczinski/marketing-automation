import { zValidator } from "@hono/zod-validator";
import {
  and,
  db,
  desc,
  eq,
  inArray,
  lt,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { approveBrief } from "../../lib/brief-service.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("briefs-route");

export const scopedBriefRoutes = new Hono();
scopedBriefRoutes.use(requireAuth);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function resolveProject(slug: string): Promise<{ id: string } | null> {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// Approval status groups for section filtering.
// Typed explicitly so inArray() gets the narrowed union rather than string[].
// Spec 63.6: `plan_pending` (Marcel approved, waiting on Planner pickup) lives
// in `pending` so the BriefsPage chips can filter it via readiness=plan_ready
// without splintering the section taxonomy.
type ApprovalStatus =
  | "pending"
  | "plan_pending"
  | "approved"
  | "rejected"
  | "auto_approved"
  | "superseded"
  | "routed";
const PENDING_STATUSES: Array<ApprovalStatus> = ["pending", "plan_pending"];
const IN_FLIGHT_STATUSES: Array<ApprovalStatus> = ["approved", "auto_approved", "routed"];
const DONE_STATUSES: Array<ApprovalStatus> = ["rejected", "superseded"];

// Brief source enum (mirrors topic_briefs.source values — see packages/db/src/schema/content.ts).
const BRIEF_SOURCES = [
  "gap_analysis",
  "trend_discovery",
  "refresh_detection",
  "manual",
  "comparison_discovery",
] as const;
type BriefSource = (typeof BRIEF_SOURCES)[number];

// ─── GET /:slug/briefs ────────────────────────────────────────────────────────

const briefsListQuerySchema = z.object({
  section: z.enum(["pending", "in-flight", "done", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
  // Comma-separated list of source values to filter by. Empty / absent = no filter.
  source: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const valid = parts.filter((p): p is BriefSource =>
        (BRIEF_SOURCES as readonly string[]).includes(p),
      );
      return valid.length > 0 ? valid : undefined;
    }),
  // Approve-readiness filter:
  //   ready       → primary_keyword is set OR source = comparison_discovery (no keyword needed)
  //   unready     → primary_keyword is NULL AND source != comparison_discovery
  //   plan_ready  → approval_status = 'plan_pending' (Spec 63.6: Marcel approved, awaiting Planner pickup)
  //   all/undef   → no filter
  readiness: z.enum(["ready", "unready", "plan_ready", "all"]).optional(),
});

scopedBriefRoutes.get(
  "/:slug/briefs",
  zValidator("query", briefsListQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const conditions = [eq(topicBriefs.projectId, project.id)];

    if (q.section === "pending") {
      conditions.push(inArray(topicBriefs.approvalStatus, PENDING_STATUSES));
    } else if (q.section === "in-flight") {
      conditions.push(inArray(topicBriefs.approvalStatus, IN_FLIGHT_STATUSES));
    } else if (q.section === "done") {
      conditions.push(inArray(topicBriefs.approvalStatus, DONE_STATUSES));
    }

    if (q.source && q.source.length > 0) {
      conditions.push(inArray(topicBriefs.source, q.source));
    }

    if (q.readiness === "ready") {
      conditions.push(
        sql`(${topicBriefs.primaryKeyword} IS NOT NULL OR ${topicBriefs.source} = 'comparison_discovery')`,
      );
    } else if (q.readiness === "unready") {
      conditions.push(
        sql`(${topicBriefs.primaryKeyword} IS NULL AND ${topicBriefs.source} <> 'comparison_discovery')`,
      );
    } else if (q.readiness === "plan_ready") {
      conditions.push(eq(topicBriefs.approvalStatus, "plan_pending"));
    }

    if (q.cursor) {
      conditions.push(lt(topicBriefs.createdAt, new Date(q.cursor)));
    }

    // Pending sorted by trend score desc; others by createdAt desc
    const orderBy =
      q.section === "pending"
        ? [
            desc(sql`COALESCE((${topicBriefs.trendMetadata}->>'trendScore')::numeric, 0)`),
            desc(topicBriefs.createdAt),
          ]
        : [desc(topicBriefs.createdAt)];

    const limit = q.limit;
    const rows = await db
      .select()
      .from(topicBriefs)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null; // safe: items is non-empty when hasMore=true (fetched limit+1)

    return c.json({
      ok: true,
      data: {
        section: q.section,
        items,
        nextCursor,
        hasMore,
        limit,
      },
    });
  },
);

// ─── GET /:slug/briefs/:briefId ──────────────────────────────────────────────

scopedBriefRoutes.get("/:slug/briefs/:briefId", async (c) => {
  const slug = c.req.param("slug");
  const briefId = c.req.param("briefId");

  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(and(eq(topicBriefs.id, briefId), eq(topicBriefs.projectId, project.id)))
    .limit(1);

  if (!brief) return c.json({ ok: false, error: "brief_not_found" }, 404);

  return c.json({ ok: true, data: { brief } });
});

// ─── POST /:slug/briefs/bulk-approve ─────────────────────────────────────────

// Spec 63.6: `dispatch` defaults to 'plan' — the safer path that flips briefs
// to plan_pending and lets the weekly Planner pick them up under the 90% Budget
// Gate. `dispatch: 'immediate'` is the explicit Direct-Generate override (legacy
// behaviour: article-INSERT + pipeline-enqueue inline). `mode` is the older
// assist/auto field; both modes today drive identical server behaviour.
const bulkApproveSchema = z.object({
  briefIds: z.array(z.string().uuid()).min(1).max(50),
  mode: z.enum(["assist", "auto"]).default("assist"),
  dispatch: z.enum(["plan", "immediate"]).default("plan"),
});

scopedBriefRoutes.post(
  "/:slug/briefs/bulk-approve",
  zValidator("json", bulkApproveSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const { briefIds, mode, dispatch } = c.req.valid("json");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const results = {
      approved: [] as Array<{ briefId: string; runId: string; jobId: string }>,
      planQueued: [] as Array<{ briefId: string }>,
      skipped: [] as Array<{ briefId: string; reason: string }>,
      failed: [] as Array<{ briefId: string; error: string }>,
    };

    // Sequential processing — predictable cost ordering, prevents budget overshoot
    for (const briefId of briefIds) {
      try {
        const result = await approveBrief(briefId, project, dispatch);

        if (result.kind === "cluster_assignment_required") {
          results.skipped.push({ briefId, reason: "cluster_assignment_required" });
        } else if (result.kind === "skipped") {
          results.skipped.push({ briefId, reason: result.reason });
        } else if (result.kind === "plan_queued") {
          results.planQueued.push({ briefId });
        } else if (result.kind === "success") {
          results.approved.push({ briefId, runId: result.runId, jobId: result.jobId });
        } else {
          results.failed.push({ briefId, error: result.error });
        }
      } catch (err) {
        results.failed.push({
          briefId,
          error: err instanceof Error ? err.message : "unknown_error",
        });
      }
    }

    log.info(
      {
        slug,
        mode,
        dispatch,
        total: briefIds.length,
        approved: results.approved.length,
        planQueued: results.planQueued.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
      },
      "bulk brief approve complete",
    );

    return c.json(
      {
        ok: true,
        data: {
          dispatch,
          total: briefIds.length,
          approvedCount: results.approved.length,
          planQueuedCount: results.planQueued.length,
          skippedCount: results.skipped.length,
          failedCount: results.failed.length,
          results,
        },
      },
      202,
    );
  },
);

// ─── POST /:slug/briefs/bulk-dismiss ─────────────────────────────────────────

const bulkDismissSchema = z.object({
  briefIds: z.array(z.string().uuid()).min(1).max(50),
});

scopedBriefRoutes.post(
  "/:slug/briefs/bulk-dismiss",
  zValidator("json", bulkDismissSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const { briefIds } = c.req.valid("json");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const updated = await db
      .update(topicBriefs)
      .set({ approvalStatus: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(topicBriefs.projectId, project.id),
          inArray(topicBriefs.id, briefIds),
          eq(topicBriefs.approvalStatus, "pending"),
        ),
      )
      .returning({ id: topicBriefs.id });

    log.info(
      { slug, requested: briefIds.length, dismissed: updated.length },
      "bulk brief dismiss complete",
    );

    return c.json({
      ok: true,
      data: {
        requested: briefIds.length,
        dismissed: updated.length,
        skipped: briefIds.length - updated.length,
      },
    });
  },
);
