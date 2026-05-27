/**
 * Spec 65.V1.5b — Recurring Budgets API.
 *
 * 2 endpoints under `/api/projects/:slug/recurring-budgets`:
 *   - GET   /  — return both budgets (dry_run + recurring_content_total).
 *                Auto-creates rows with default limits on first access.
 *   - PATCH /:budgetType  — update the monthly limit for one budget.
 *
 * Multi-tenancy: slug resolves to `projects.id` and every helper call
 * receives that id. Cross-project access returns 404.
 */
import { zValidator } from "@hono/zod-validator";
import { db, eq, projects } from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import {
  listProjectBudgets,
  updateBudgetLimit,
} from "../../lib/recurring-content/budget-check.ts";

export const recurringBudgetsRoutes = new Hono();
recurringBudgetsRoutes.use(requireAuth);

const budgetTypeSchema = z.enum(["dry_run", "recurring_content_total"]);
const patchBudgetBodySchema = z.object({
  monthlyLimitCents: z.number().int().min(0).max(1_000_000), // €10,000 hard cap
});

async function loadProject(slug: string) {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj;
}

// ─── GET /:slug/recurring-budgets ─────────────────────────────────────────────

recurringBudgetsRoutes.get("/:slug/recurring-budgets", async (c) => {
  const slug = c.req.param("slug");
  const project = await loadProject(slug);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const budgets = await listProjectBudgets(project.id);
  return c.json({ ok: true, data: budgets });
});

// ─── PATCH /:slug/recurring-budgets/:budgetType ───────────────────────────────

recurringBudgetsRoutes.patch(
  "/:slug/recurring-budgets/:budgetType",
  zValidator("json", patchBudgetBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const rawType = c.req.param("budgetType");
    const typeParse = budgetTypeSchema.safeParse(rawType);
    if (!typeParse.success) {
      return c.json({ ok: false, error: "Invalid budget type" }, 400);
    }
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const { monthlyLimitCents } = c.req.valid("json");
    const updated = await updateBudgetLimit({
      projectId: project.id,
      budgetType: typeParse.data,
      monthlyLimitCents,
    });
    return c.json({ ok: true, data: updated });
  },
);
