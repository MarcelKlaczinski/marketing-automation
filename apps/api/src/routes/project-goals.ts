// Spec 62.2: project goals + planner config CRUD + validation endpoint.
//
// Seven endpoints, all auth-protected. Patterns:
//   - Slug → project lookup, 404 if missing
//   - { ok: true, data } / { ok: false, error } envelope
//   - PUT /goals semantics: full replace (insert/update/soft-delete diff in transaction)
//   - validate endpoint wires the live pipelineRegistry into the cost-tracker validator
//
// 62.4 (Planner-Engine) will call `validateProjectGoals` directly (library import) and
// hit the same endpoint from the UI's validation banner. Both paths share the same
// resolvePipelineSteps wiring.

import { zValidator } from "@hono/zod-validator";
import {
  db,
  eq,
  getProjectPlannerConfig,
  listProjectGoals,
  patchProjectGoal,
  projects,
  replaceProjectGoals,
  softDeleteProjectGoal,
  upsertProjectPlannerConfig,
} from "@marketing-auto/db";
import type { EstimatorStep } from "@marketing-auto/cost-tracker";
import { validateProjectGoals } from "@marketing-auto/planner";
import { pipelineRegistry } from "@marketing-auto/pipelines";
import {
  createLogger,
  patchProjectGoalPayloadSchema,
  projectPlannerConfigSchema,
  putProjectGoalsPayloadSchema,
} from "@marketing-auto/shared";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.ts";

const log = createLogger("api:project-goals");

export const projectGoalsRoutes = new Hono();
projectGoalsRoutes.use(requireAuth);

async function resolveProjectId(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

/** Wire pipelineRegistry to the EstimatorStep callback used by validateProjectGoals. */
const resolvePipelineSteps = (
  name: string
): ReadonlyArray<EstimatorStep> | undefined => {
  const pipeline = pipelineRegistry.get(name);
  if (!pipeline) return undefined;
  return pipeline.steps as ReadonlyArray<EstimatorStep>;
};

// ─── GET /api/projects/:slug/goals ────────────────────────────────────────────
projectGoalsRoutes.get("/projects/:slug/goals", async (c) => {
  const slug = c.req.param("slug");
  const projectId = await resolveProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

  const goals = await listProjectGoals({ projectId, activeOnly: true });
  return c.json({ ok: true, data: goals });
});

// ─── PUT /api/projects/:slug/goals ────────────────────────────────────────────
// Full replace: server diffs the body against active rows.
projectGoalsRoutes.put(
  "/projects/:slug/goals",
  zValidator("json", putProjectGoalsPayloadSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const projectId = await resolveProjectId(slug);
    if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");

    // Cross-row check: no duplicate content_type in the body.
    const contentTypes = body.goals.map((g) => g.contentType);
    if (new Set(contentTypes).size !== contentTypes.length) {
      return c.json(
        { ok: false, error: "duplicate_content_type_in_body" },
        400
      );
    }

    const result = await replaceProjectGoals({
      projectId,
      goals: body.goals.map((g) => ({
        contentType: g.contentType,
        cadenceUnit: g.cadenceUnit,
        minCount: g.minCount,
        maxCount: g.maxCount,
        ...(g.note !== undefined ? { note: g.note } : {}),
      })),
    });

    log.info(
      {
        projectId,
        inserted: result.inserted.length,
        updated: result.updated.length,
        deactivated: result.deactivated.length,
      },
      "Project goals replaced"
    );

    const goals = await listProjectGoals({ projectId, activeOnly: true });
    return c.json({ ok: true, data: goals });
  }
);

// ─── PATCH /api/projects/:slug/goals/:goalId ──────────────────────────────────
projectGoalsRoutes.patch(
  "/projects/:slug/goals/:goalId",
  zValidator("json", patchProjectGoalPayloadSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const goalId = c.req.param("goalId");
    const projectId = await resolveProjectId(slug);
    if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const updated = await patchProjectGoal({
      id: goalId,
      projectId,
      ...(body.cadenceUnit !== undefined ? { cadenceUnit: body.cadenceUnit } : {}),
      ...(body.minCount !== undefined ? { minCount: body.minCount } : {}),
      ...(body.maxCount !== undefined ? { maxCount: body.maxCount } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
    if (!updated) return c.json({ ok: false, error: "goal_not_found" }, 404);

    // Reactivating a row that conflicts with an already-active row for the same content_type
    // raises the partial unique index `project_goals_one_active_per_type` in the helper. We
    // do not wrap it here — the constraint violation surfaces as a 500, which is correct for
    // a true race condition (concurrent PATCH on a single-user project is not expected).
    return c.json({ ok: true, data: updated });
  }
);

// ─── DELETE /api/projects/:slug/goals/:goalId ─────────────────────────────────
// Soft-delete (sets is_active=false). The row remains for history.
projectGoalsRoutes.delete("/projects/:slug/goals/:goalId", async (c) => {
  const slug = c.req.param("slug");
  const goalId = c.req.param("goalId");
  const projectId = await resolveProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

  const ok = await softDeleteProjectGoal({ id: goalId, projectId });
  if (!ok) return c.json({ ok: false, error: "goal_not_found" }, 404);

  return c.json({ ok: true, data: { id: goalId, isActive: false } });
});

// ─── GET /api/projects/:slug/planner-config ───────────────────────────────────
projectGoalsRoutes.get("/projects/:slug/planner-config", async (c) => {
  const slug = c.req.param("slug");
  const projectId = await resolveProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

  const config = await getProjectPlannerConfig(projectId);
  return c.json({ ok: true, data: config });
});

// ─── PUT /api/projects/:slug/planner-config ───────────────────────────────────
projectGoalsRoutes.put(
  "/projects/:slug/planner-config",
  zValidator("json", projectPlannerConfigSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const projectId = await resolveProjectId(slug);
    if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const config = await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: body.weeklyBudgetEur,
      perTypeMaxEur: body.perTypeMaxEur ?? null,
      topNSignalsAllowedOverage: body.topNSignalsAllowedOverage,
      maxOveragePerSignal: body.maxOveragePerSignal,
      // Spec 62.7: cron-trigger settings. The helper internally syncs the
      // `cron_state` row's pattern + is_active so the orchestrator picks up the
      // change on the next minute-tick.
      cronEnabled: body.cronEnabled,
      cronDayOfWeek: body.cronDayOfWeek,
      cronHourUtc: body.cronHourUtc,
      // Spec 63.3b: second cron (comparison_discovery), independent toggle.
      comparisonCronEnabled: body.comparisonCronEnabled,
      comparisonCronDayOfWeek: body.comparisonCronDayOfWeek,
      comparisonCronHourUtc: body.comparisonCronHourUtc,
    });

    log.info(
      {
        projectId,
        weeklyBudgetEur: body.weeklyBudgetEur,
        cronEnabled: body.cronEnabled,
        cronPattern: `0 ${body.cronHourUtc} * * ${body.cronDayOfWeek}`,
        comparisonCronEnabled: body.comparisonCronEnabled,
        comparisonCronPattern: `0 ${body.comparisonCronHourUtc} * * ${body.comparisonCronDayOfWeek}`,
      },
      "Planner config upserted",
    );
    return c.json({ ok: true, data: config });
  }
);

// ─── GET /api/projects/:slug/goals/validate ───────────────────────────────────
// Runs validateProjectGoals against live DB + pipeline registry. Returns the full
// GoalValidationResult so the UI can render banners for each error/warning code.
projectGoalsRoutes.get("/projects/:slug/goals/validate", async (c) => {
  const slug = c.req.param("slug");
  const projectId = await resolveProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: "project_not_found" }, 404);

  const result = await validateProjectGoals(projectId, { resolvePipelineSteps });
  return c.json({ ok: true, data: result });
});
