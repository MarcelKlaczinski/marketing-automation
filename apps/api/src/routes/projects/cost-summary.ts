import {
  and,
  articles,
  costLogs,
  db,
  eq,
  gte,
  projects,
  sql,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";

export const projectCostSummaryRoutes = new Hono();

projectCostSummaryRoutes.use(requireAuth);

const costSummaryQuerySchema = z.object({
  window: z.enum(["today", "week", "month", "year"]).default("month"),
});

function getWindowStart(now: Date, window: "today" | "week" | "month" | "year"): Date {
  const start = new Date(now);
  switch (window) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  return start;
}

// ─── GET /:slug/cost-summary?window= ─────────────────────────────────────────
projectCostSummaryRoutes.get("/:slug/cost-summary", async (c) => {
  const { slug } = c.req.param();

  const result = costSummaryQuerySchema.safeParse(c.req.query());
  if (!result.success) {
    return c.json({ ok: false, error: "validation_error", details: result.error.flatten() }, 400);
  }
  const { window } = result.data;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const now = new Date();
  const windowStart = getWindowStart(now, window);
  const baseWhere = and(eq(costLogs.projectId, project.id), gte(costLogs.createdAt, windowStart));

  const [totalResult, byServiceResult, byOperationResult, trendResult, articleCountResult] =
    await Promise.all([
      db
        .select({ total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)` })
        .from(costLogs)
        .where(baseWhere),

      db
        .select({
          service: costLogs.service,
          total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
        })
        .from(costLogs)
        .where(baseWhere)
        .groupBy(costLogs.service),

      db
        .select({
          operation: costLogs.operation,
          total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
        })
        .from(costLogs)
        .where(baseWhere)
        .groupBy(costLogs.operation),

      db
        .select({
          date: sql<string>`DATE(${costLogs.createdAt})`,
          total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
        })
        .from(costLogs)
        .where(baseWhere)
        .groupBy(sql`DATE(${costLogs.createdAt})`)
        .orderBy(sql`DATE(${costLogs.createdAt})`),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, project.id),
            eq(articles.source, "generated"),
            gte(articles.createdAt, windowStart),
          ),
        ),
    ]);

  const byService = Object.fromEntries(
    byServiceResult.map((r) => [r.service, Number(r.total)]),
  );
  const byOperation = Object.fromEntries(
    byOperationResult.map((r) => [r.operation, Number(r.total)]),
  );

  return c.json({
    ok: true,
    data: {
      window,
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      totalEur: Number(totalResult[0]?.total ?? 0),
      articleCount: articleCountResult[0]?.count ?? 0,
      byService,
      byOperation,
      trend: trendResult.map((t) => ({
        date: t.date,
        costEur: Number(t.total),
      })),
    },
  });
});
