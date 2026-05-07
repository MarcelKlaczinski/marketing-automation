import { type CostLimits, costLogs, type costServiceEnum, db, projects } from "@marketing-auto/db";
import { and, eq, gte, sql } from "drizzle-orm";

type CostService = (typeof costServiceEnum.enumValues)[number];

/**
 * Thrown when a planned operation would exceed configured limits.
 */
export class CostLimitExceeded extends Error {
  constructor(
    public readonly details: {
      projectId: string;
      service: CostService;
      scope: "daily" | "monthly";
      limitEur: number;
      currentSpendEur: number;
      attemptedCostEur: number;
    }
  ) {
    super(
      `Cost limit exceeded: ${details.scope} limit of €${details.limitEur} for ${details.service} ` +
        `on project ${details.projectId} (current: €${details.currentSpendEur.toFixed(4)}, ` +
        `attempted: €${details.attemptedCostEur.toFixed(4)})`
    );
    this.name = "CostLimitExceeded";
  }
}

const DEFAULT_ALERT_PERCENT = 80;
const DEFAULT_KILL_PERCENT = 100;

/**
 * Returns the configured limits for a project + service, with defaults.
 */
export async function getLimits(input: { projectId: string; service: CostService }): Promise<{
  dailyEur: number | null;
  monthlyEur: number | null;
  alertAtPercent: number;
  killAtPercent: number;
}> {
  const rows = await db
    .select({ costLimits: projects.costLimits })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  const limits = (rows[0]?.costLimits as CostLimits) ?? {};

  return {
    dailyEur: limits.daily?.[input.service] ?? null,
    monthlyEur: limits.monthly?.[input.service] ?? null,
    alertAtPercent: limits.alertAtPercent ?? DEFAULT_ALERT_PERCENT,
    killAtPercent: limits.killAtPercent ?? DEFAULT_KILL_PERCENT,
  };
}

/**
 * Returns current spend for a project + service in EUR.
 */
export async function getCurrentSpend(input: {
  projectId: string;
  service: CostService;
}): Promise<{ daily: number; monthly: number }> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [row] = await db
    .select({
      daily: sql<string>`COALESCE(SUM(CASE WHEN ${costLogs.createdAt} >= ${startOfDay.toISOString()} THEN ${costLogs.costEur} ELSE 0 END), 0)`,
      monthly: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
    })
    .from(costLogs)
    .where(
      and(
        eq(costLogs.projectId, input.projectId),
        eq(costLogs.service, input.service),
        gte(costLogs.createdAt, startOfMonth)
      )
    );

  return {
    daily: Number(row?.daily ?? 0),
    monthly: Number(row?.monthly ?? 0),
  };
}

/**
 * Checks whether a planned operation would exceed limits.
 * Throws CostLimitExceeded if it would.
 * Returns alert info if an alert threshold is crossed.
 */
export async function checkLimit(input: {
  projectId: string;
  service: CostService;
  estimatedCostEur: number;
}): Promise<{
  ok: true;
  alertTriggered?: { scope: "daily" | "monthly"; percent: number; limitEur: number };
}> {
  const limits = await getLimits({ projectId: input.projectId, service: input.service });
  const spend = await getCurrentSpend({ projectId: input.projectId, service: input.service });

  const checkScope = (
    scope: "daily" | "monthly",
    limitEur: number | null,
    current: number
  ): { alertTriggered?: { scope: "daily" | "monthly"; percent: number; limitEur: number } } => {
    if (limitEur === null) return {};
    const projected = current + input.estimatedCostEur;
    const projectedPercent = (projected / limitEur) * 100;

    if (projectedPercent >= limits.killAtPercent) {
      throw new CostLimitExceeded({
        projectId: input.projectId,
        service: input.service,
        scope,
        limitEur,
        currentSpendEur: current,
        attemptedCostEur: input.estimatedCostEur,
      });
    }

    if (projectedPercent >= limits.alertAtPercent) {
      return { alertTriggered: { scope, percent: projectedPercent, limitEur } };
    }
    return {};
  };

  const dailyAlert = checkScope("daily", limits.dailyEur, spend.daily);
  const monthlyAlert = checkScope("monthly", limits.monthlyEur, spend.monthly);

  const alertTriggered = dailyAlert.alertTriggered ?? monthlyAlert.alertTriggered;
  if (alertTriggered !== undefined) {
    return { ok: true, alertTriggered };
  }
  return { ok: true };
}
