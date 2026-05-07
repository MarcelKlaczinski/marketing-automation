import { Hono } from "hono";
import { eq, and, gte, lte, desc, sql, like } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, costLogs, projects } from "@marketing-auto/db";
import { requireAuth } from "../middleware/auth.ts";

export const costRoutes = new Hono();
costRoutes.use(requireAuth);

interface AggregationBucket {
  service: string;
  operation: string;
  totalEur: string;
  callCount: number;
}

interface DailyTotal {
  day: string;
  totalEur: string;
}

interface AggregationsResponse {
  thisMonth: {
    totalEur: string;
    byService: Array<{ service: string; totalEur: string; callCount: number }>;
    byServiceAndOperation: AggregationBucket[];
    daily: DailyTotal[];
  };
  lastMonth: {
    totalEur: string;
    byService: Array<{ service: string; totalEur: string; callCount: number }>;
  };
  thisYear: {
    totalEur: string;
    byMonth: Array<{ month: string; totalEur: string }>;
  };
}

const aggregationsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});

// GET /api/cost/aggregations
// Optional query: ?projectId=xxx to filter to a single project.
costRoutes.get("/aggregations", zValidator("query", aggregationsQuerySchema), async (c) => {
  const { projectId } = c.req.valid("query");
  const projectFilter = projectId ? eq(costLogs.projectId, projectId) : undefined;

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const baseThisMonth = [gte(costLogs.createdAt, startOfThisMonth), ...(projectFilter ? [projectFilter] : [])];
  const baseLastMonth = [gte(costLogs.createdAt, startOfLastMonth), lte(costLogs.createdAt, endOfLastMonth), ...(projectFilter ? [projectFilter] : [])];
  const baseThisYear = [gte(costLogs.createdAt, startOfYear), ...(projectFilter ? [projectFilter] : [])];

  const [
    thisMonthTotalRow,
    thisMonthByService,
    thisMonthByOp,
    thisMonthDaily,
    lastMonthByService,
    lastMonthTotalRow,
    thisYearTotalRow,
    thisYearByMonth,
  ] = await Promise.all([
    db.select({ totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text` })
      .from(costLogs).where(and(...baseThisMonth)),

    db.select({
      service: costLogs.service,
      totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
      callCount: sql<number>`count(*)::int`,
    }).from(costLogs).where(and(...baseThisMonth)).groupBy(costLogs.service),

    db.select({
      service: costLogs.service,
      operation: costLogs.operation,
      totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
      callCount: sql<number>`count(*)::int`,
    }).from(costLogs).where(and(...baseThisMonth))
      .groupBy(costLogs.service, costLogs.operation)
      .orderBy(desc(sql`sum(${costLogs.costEur})`)),

    db.select({
      day: sql<string>`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`,
      totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    }).from(costLogs).where(and(...baseThisMonth))
      .groupBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`),

    db.select({
      service: costLogs.service,
      totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
      callCount: sql<number>`count(*)::int`,
    }).from(costLogs).where(and(...baseLastMonth)).groupBy(costLogs.service),

    db.select({ totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text` })
      .from(costLogs).where(and(...baseLastMonth)),

    db.select({ totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text` })
      .from(costLogs).where(and(...baseThisYear)),

    db.select({
      month: sql<string>`to_char(${costLogs.createdAt}, 'YYYY-MM')`,
      totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    }).from(costLogs).where(and(...baseThisYear))
      .groupBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM')`),
  ]);

  const response: AggregationsResponse = {
    thisMonth: {
      totalEur: thisMonthTotalRow[0]?.totalEur ?? "0",
      byService: thisMonthByService,
      byServiceAndOperation: thisMonthByOp,
      daily: thisMonthDaily,
    },
    lastMonth: {
      totalEur: lastMonthTotalRow[0]?.totalEur ?? "0",
      byService: lastMonthByService,
    },
    thisYear: {
      totalEur: thisYearTotalRow[0]?.totalEur ?? "0",
      byMonth: thisYearByMonth,
    },
  };

  return c.json({ ok: true, data: response });
});

// GET /api/cost/logs
// Paginated detail logs with filters.
const logsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  service: z.enum(["anthropic", "replicate", "dataforseo", "smtp"]).optional(),
  operation: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

costRoutes.get("/logs", zValidator("query", logsQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const filters = [];
  if (q.projectId) filters.push(eq(costLogs.projectId, q.projectId));
  if (q.service) filters.push(eq(costLogs.service, q.service));
  if (q.operation) filters.push(like(costLogs.operation, `%${q.operation}%`));
  if (q.from) filters.push(gte(costLogs.createdAt, new Date(q.from)));
  if (q.to) filters.push(lte(costLogs.createdAt, new Date(q.to)));

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [logs, countRows] = await Promise.all([
    db.select({
      id: costLogs.id,
      projectId: costLogs.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      service: costLogs.service,
      operation: costLogs.operation,
      costEur: costLogs.costEur,
      metadata: costLogs.metadata,
      pipelineRunId: costLogs.pipelineRunId,
      articleId: costLogs.articleId,
      createdAt: costLogs.createdAt,
    })
      .from(costLogs)
      .leftJoin(projects, eq(costLogs.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(costLogs.createdAt))
      .limit(q.limit)
      .offset(q.offset),

    db.select({ count: sql<number>`count(*)::int` })
      .from(costLogs)
      .where(whereClause),
  ]);

  return c.json({
    ok: true,
    data: {
      logs,
      total: countRows[0]?.count ?? 0,
      limit: q.limit,
      offset: q.offset,
    },
  });
});
