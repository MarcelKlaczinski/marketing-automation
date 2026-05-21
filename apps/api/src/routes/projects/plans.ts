// Spec 62.4: PlanWeekPipeline HTTP surface.
//
//   POST   /:slug/plans/generate                  → triggers PlanWeekPipeline (202 / 200 / 402 / 423)
//   GET    /:slug/plans                            → list plans with optional filters
//   GET    /:slug/plans/:planId                    → plan + its planned_items
//   PATCH  /:slug/plans/:planId                    → status transition (approve / cancel)
//   PATCH  /:slug/plans/:planId/items/:itemId      → item-level cancel

import { zValidator } from "@hono/zod-validator";
import {
  cancelPlannedItem,
  db,
  eq,
  getWeeklyPlanById,
  listPlannedItemsByPlan,
  listWeeklyPlans,
  PlanAlreadyExistsError,
  projects,
  reschedulePlannedItem,
  transitionWeeklyPlanStatus,
} from "@marketing-auto/db";
import { enqueuePlanWeekPipeline } from "@marketing-auto/pipelines";
import {
  createLogger,
  generatePlanPayloadSchema,
  patchPlannedItemPayloadSchema,
  patchWeeklyPlanPayloadSchema,
} from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import {
  triggerResultToResponse,
  triggerWithPreRunId,
} from "../_lib/trigger-helpers.ts";

const log = createLogger("api:plans");

export const planRoutes = new Hono();
planRoutes.use(requireAuth);

async function resolveProject(slug: string): Promise<{ id: string } | null> {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// ─── POST /:slug/plans/generate ───────────────────────────────────────────────

planRoutes.post(
  "/:slug/plans/generate",
  zValidator(
    "json",
    generatePlanPayloadSchema,
    (result, c) => (result.success ? undefined : c.json({ ok: false, error: result.error.message }, 400)),
  ),
  async (c) => {
    const slug = c.req.param("slug");
    if (!slug) return c.json({ ok: false, error: "missing :slug" }, 400);
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const triggeredBy = c.var.user?.email ?? "system";

    try {
      const debugMode = body.debug === true;
      const result = await triggerWithPreRunId({
        pipelineName: "planning:weekly",
        projectId: proj.id,
        uniqueKey: {
          field: "planKey",
          // Spec 62.6.1: include "-debug" so a debug run does not dedupe against
          // a previously-active production run for the same week (and vice versa).
          value: `${body.targetYear}-${body.targetIsoWeek}${debugMode ? "-debug" : ""}`,
        },
        // The Planner itself does no LLM calls — cost is enforced at item-
        // execution time in 62.8. Pre-flight nothing here.
        enqueue: (input) =>
          enqueuePlanWeekPipeline({
            ...input,
            triggeredBy,
            targetYear: body.targetYear,
            targetIsoWeek: body.targetIsoWeek,
            force: body.force ?? false,
            ...(debugMode ? { runMode: "debug" as const } : {}),
          }),
        extraInput: {
          planKey: `${body.targetYear}-${body.targetIsoWeek}${debugMode ? "-debug" : ""}`,
          targetYear: body.targetYear,
          targetIsoWeek: body.targetIsoWeek,
          force: body.force ?? false,
          triggeredBy,
        },
        ...(debugMode ? { runMode: "debug" as const } : {}),
      });
      return triggerResultToResponse(c, result);
    } catch (err) {
      if (err instanceof PlanAlreadyExistsError) {
        return c.json(
          { ok: false, error: "plan_already_exists", existingPlanId: err.existingPlanId },
          409,
        );
      }
      log.error({ err, projectId: proj.id }, "plan generation failed");
      const message = err instanceof Error ? err.message : "internal error";
      return c.json({ ok: false, error: message }, 500);
    }
  },
);

// ─── GET /:slug/plans ─────────────────────────────────────────────────────────

const listPlansQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  week: z.coerce.number().int().optional(),
  status: z
    .enum([
      "draft",
      "approved",
      "running",
      "completed",
      "partially_failed",
      "cancelled",
      "superseded",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

planRoutes.get(
  "/:slug/plans",
  zValidator(
    "query",
    listPlansQuerySchema,
    (result, c) => (result.success ? undefined : c.json({ ok: false, error: result.error.message }, 400)),
  ),
  async (c) => {
    const slug = c.req.param("slug");
    if (!slug) return c.json({ ok: false, error: "missing :slug" }, 400);
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const q = c.req.valid("query");
    const opts: Parameters<typeof listWeeklyPlans>[0] = {
      projectId: proj.id,
      limit: q.limit,
    };
    if (q.year !== undefined) opts.year = q.year;
    if (q.week !== undefined) opts.isoWeek = q.week;
    if (q.status !== undefined) opts.statuses = [q.status];
    const plans = await listWeeklyPlans(opts);
    return c.json({ ok: true, data: plans });
  },
);

// ─── GET /:slug/plans/:planId ─────────────────────────────────────────────────

planRoutes.get("/:slug/plans/:planId", async (c) => {
  const slug = c.req.param("slug");
  const planId = c.req.param("planId");
  if (!slug || !planId) return c.json({ ok: false, error: "missing param" }, 400);
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

  const plan = await getWeeklyPlanById(planId);
  if (!plan || plan.projectId !== proj.id) {
    return c.json({ ok: false, error: "plan_not_found" }, 404);
  }
  const items = await listPlannedItemsByPlan(planId);
  return c.json({ ok: true, data: { plan, items } });
});

// ─── PATCH /:slug/plans/:planId ───────────────────────────────────────────────

planRoutes.patch(
  "/:slug/plans/:planId",
  zValidator(
    "json",
    patchWeeklyPlanPayloadSchema,
    (result, c) => (result.success ? undefined : c.json({ ok: false, error: result.error.message }, 400)),
  ),
  async (c) => {
    const slug = c.req.param("slug");
    const planId = c.req.param("planId");
    if (!slug || !planId) return c.json({ ok: false, error: "missing param" }, 400);
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    const plan = await getWeeklyPlanById(planId);
    if (!plan || plan.projectId !== proj.id) {
      return c.json({ ok: false, error: "plan_not_found" }, 404);
    }

    const body = c.req.valid("json");
    const opts: Parameters<typeof transitionWeeklyPlanStatus>[0] = {
      planId,
      toStatus: body.status,
    };
    if (body.status === "approved") {
      opts.approvedBy = body.approvedBy ?? c.var.user?.email ?? "system";
    }
    const updated = await transitionWeeklyPlanStatus(opts);
    if (!updated) {
      return c.json(
        { ok: false, error: "invalid_transition", currentStatus: plan.status },
        409,
      );
    }
    return c.json({ ok: true, data: updated });
  },
);

// ─── PATCH /:slug/plans/:planId/items/:itemId ─────────────────────────────────

planRoutes.patch(
  "/:slug/plans/:planId/items/:itemId",
  zValidator(
    "json",
    patchPlannedItemPayloadSchema,
    (result, c) => (result.success ? undefined : c.json({ ok: false, error: result.error.message }, 400)),
  ),
  async (c) => {
    const slug = c.req.param("slug");
    const planId = c.req.param("planId");
    const itemId = c.req.param("itemId");
    if (!slug || !planId || !itemId) return c.json({ ok: false, error: "missing param" }, 400);
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "project_not_found" }, 404);

    // Project-membership guard (defence-in-depth). The helpers below enforce
    // item-vs-plan + status guards atomically.
    const plan = await getWeeklyPlanById(planId);
    if (!plan || plan.projectId !== proj.id) {
      return c.json({ ok: false, error: "plan_not_found" }, 404);
    }

    const body = c.req.valid("json");

    // 62.5 reschedule path — body validation already enforced exclusive-or
    // between `status` and `slotDate`.
    if (body.slotDate !== undefined) {
      const newSlotDate = new Date(`${body.slotDate}T00:00:00.000Z`);
      const result = await reschedulePlannedItem({
        planId,
        itemId,
        newSlotDate,
      });
      if (!result.ok) {
        if (result.reason === "not_found") {
          return c.json({ ok: false, error: "item_not_found" }, 404);
        }
        if (result.reason === "out_of_range") {
          return c.json(
            { ok: false, error: "slot_date_outside_plan_week" },
            422,
          );
        }
        return c.json({ ok: false, error: result.reason }, 409);
      }
      if (result.item.projectId !== proj.id) {
        return c.json({ ok: false, error: "item_does_not_belong_to_project" }, 409);
      }
      return c.json({ ok: true, data: result.item });
    }

    // 62.4 cancel path.
    const updated = await cancelPlannedItem(itemId);
    if (!updated) {
      return c.json({ ok: false, error: "invalid_item_state_or_missing" }, 409);
    }
    if (updated.projectId !== proj.id || updated.weeklyPlanId !== planId) {
      return c.json({ ok: false, error: "item_does_not_belong_to_plan" }, 409);
    }
    return c.json({ ok: true, data: updated });
  },
);
