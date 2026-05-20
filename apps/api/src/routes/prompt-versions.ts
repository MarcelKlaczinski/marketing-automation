// Spec 62.0b Section 6: read endpoints for prompt_versions + step_optimization_requests,
// plus a single PATCH endpoint to close out optimization requests.
import { zValidator } from "@hono/zod-validator";
import {
  db,
  getOptimizationRequestById,
  listOptimizationRequestsForProject,
  listPromptVersionsForProject,
  projects,
  updateOptimizationRequestStatus,
} from "@marketing-auto/db";
import {
  createLogger,
  optimizationRequestStatusSchema,
  updateOptimizationRequestPayloadSchema,
} from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

const log = createLogger("api:prompt-versions");

export const promptVersionsRoutes = new Hono();
promptVersionsRoutes.use(requireAuth);

const PromptVersionsQuerySchema = z.object({
  stepName: z.string().min(1).max(200).optional(),
});

// ─── GET /api/projects/:slug/prompt-versions ──────────────────────────────────
// Returns every prompt_versions row for a project, newest first. `is_golden=true` row
// is the active prompt; the rest are history (superseded). Used by the future 62.6 UI
// to show "what golden is active per step" + the audit trail of promotes.
promptVersionsRoutes.get("/projects/:slug/prompt-versions", async (c) => {
  const projectSlug = c.req.param("slug");
  const parsed = PromptVersionsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "invalid_query", details: parsed.error.flatten() },
      400
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const versions = await listPromptVersionsForProject({
    projectId: project.id,
    ...(parsed.data.stepName !== undefined ? { stepName: parsed.data.stepName } : {}),
  });
  return c.json({ ok: true, data: versions });
});

const OptimizationRequestsQuerySchema = z.object({
  status: optimizationRequestStatusSchema.optional(),
});

// ─── GET /api/projects/:slug/optimization-requests ────────────────────────────
// Returns optimization requests for a project, newest first. Optional `?status=open`
// (default returns all statuses). Used by the future 62.6 inbox view + by Marcel's
// "what did I flag for review" workflow.
promptVersionsRoutes.get("/projects/:slug/optimization-requests", async (c) => {
  const projectSlug = c.req.param("slug");
  const parsed = OptimizationRequestsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "invalid_query", details: parsed.error.flatten() },
      400
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const requests = await listOptimizationRequestsForProject({
    projectId: project.id,
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
  });
  return c.json({ ok: true, data: requests });
});

// ─── PATCH /api/optimization-requests/:id ─────────────────────────────────────
// Closes out an optimization request after Marcel has dealt with it (promoted a new
// golden, edited the step's prompt, or decided it was noise). Status transitions are
// terminal in 62.0b — re-opening is not supported.
promptVersionsRoutes.patch(
  "/optimization-requests/:id",
  zValidator("json", updateOptimizationRequestPayloadSchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await getOptimizationRequestById(id);
    if (!existing) return c.json({ ok: false, error: "not_found" }, 404);

    const updated = await updateOptimizationRequestStatus({
      id,
      status: body.status,
      ...(body.addressedNote !== undefined ? { addressedNote: body.addressedNote } : {}),
    });
    if (!updated) return c.json({ ok: false, error: "not_found" }, 404);

    log.info(
      { id, oldStatus: existing.status, newStatus: body.status },
      "Optimization request status updated"
    );
    return c.json({ ok: true, data: updated });
  }
);
