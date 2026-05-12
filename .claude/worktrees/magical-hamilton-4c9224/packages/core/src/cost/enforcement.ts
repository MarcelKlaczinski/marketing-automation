import { costAlerts, costLogs, db, projects, users } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import { createNotification } from "../notifications/index.ts";
import { pauseProjectQueues } from "./pause.ts";

const log = createLogger("cost-enforcement");

export class CostLimitExceededError extends Error {
  readonly service: string;
  readonly thresholdType: "daily" | "monthly";
  readonly limitEur: number;
  readonly spentEur: number;
  readonly projectId: string;

  constructor(
    service: string,
    thresholdType: "daily" | "monthly",
    limitEur: number,
    spentEur: number,
    projectId: string
  ) {
    super(
      `cost_limit_exceeded: ${service} ${thresholdType} limit ${limitEur} EUR, spent ${spentEur} EUR`
    );
    this.name = "CostLimitExceededError";
    this.service = service;
    this.thresholdType = thresholdType;
    this.limitEur = limitEur;
    this.spentEur = spentEur;
    this.projectId = projectId;
  }
}

export interface CostBudgetOk {
  ok: true;
  alertTriggered?: boolean;
  alertPercent?: number;
}

export interface CostBudgetExceeded {
  ok: false;
  service: string;
  thresholdType: "daily" | "monthly";
  limitEur: number;
  spentEur: number;
  projectedSpendEur: number;
}

/**
 * Pre-flight cost check. Returns ok=true when budget has headroom, ok=false when
 * the projected spend would hit or exceed killAtPercent.
 *
 * Side effect: writes a cost_alerts row when alertAtPercent is crossed (deduped per 6h window).
 */
export async function checkCostBudget(
  projectId: string,
  service: string,
  estimatedCostEur: number
): Promise<CostBudgetOk | CostBudgetExceeded> {
  const [project] = await db
    .select({ costLimits: projects.costLimits })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const limits = project?.costLimits;
  if (!limits || (!limits.daily && !limits.monthly)) {
    return { ok: true };
  }

  const killPercent = limits.killAtPercent ?? 100;
  const alertPercent = limits.alertAtPercent ?? 80;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDayIso = startOfDay.toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [spendRow] = await db
    .select({
      daySpend: sql<string>`coalesce(sum(case when ${costLogs.createdAt} >= ${startOfDayIso} then ${costLogs.costEur} else 0 end), 0)::text`,
      monthSpend: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    })
    .from(costLogs)
    .where(
      and(
        eq(costLogs.projectId, projectId),
        // costServiceEnum only accepts its literal values; cast service through sql to avoid runtime error
        // when the service string is a valid enum value — Drizzle enforces the enum on insert, not select
        sql`${costLogs.service} = ${service}`,
        gte(costLogs.createdAt, startOfMonth)
      )
    );

  const daySpend = Number.parseFloat(spendRow?.daySpend ?? "0");
  const monthSpend = Number.parseFloat(spendRow?.monthSpend ?? "0");

  // Check daily limit
  const dailyLimit = limits.daily?.[service];
  if (dailyLimit !== undefined) {
    const projectedDay = daySpend + estimatedCostEur;
    const projectedDayPct = (projectedDay / dailyLimit) * 100;

    if (projectedDayPct >= killPercent) {
      return {
        ok: false,
        service,
        thresholdType: "daily",
        limitEur: dailyLimit,
        spentEur: daySpend,
        projectedSpendEur: projectedDay,
      };
    }

    if (projectedDayPct >= alertPercent) {
      await maybeRecordAlert(
        projectId,
        service,
        "daily",
        dailyLimit,
        projectedDay,
        projectedDayPct
      );
    }
  }

  // Check monthly limit
  const monthlyLimit = limits.monthly?.[service];
  if (monthlyLimit !== undefined) {
    const projectedMonth = monthSpend + estimatedCostEur;
    const projectedMonthPct = (projectedMonth / monthlyLimit) * 100;

    if (projectedMonthPct >= killPercent) {
      return {
        ok: false,
        service,
        thresholdType: "monthly",
        limitEur: monthlyLimit,
        spentEur: monthSpend,
        projectedSpendEur: projectedMonth,
      };
    }

    if (projectedMonthPct >= alertPercent) {
      await maybeRecordAlert(
        projectId,
        service,
        "monthly",
        monthlyLimit,
        projectedMonth,
        projectedMonthPct
      );
    }
  }

  return { ok: true };
}

/**
 * Asserts cost budget. Throws CostLimitExceededError if exceeded, also pausing the project's queues.
 * Used as a pre-call hook in adapter clients.
 */
export async function assertCostBudget(
  projectId: string,
  service: string,
  estimatedCostEur: number
): Promise<void> {
  const result = await checkCostBudget(projectId, service, estimatedCostEur);
  if (!result.ok) {
    await pauseProjectQueues(
      projectId,
      "cost_limit_exceeded",
      {
        service: result.service,
        thresholdType: result.thresholdType,
        limitEur: result.limitEur,
        spentEur: result.spentEur,
      },
      result.service
    );
    throw new CostLimitExceededError(
      result.service,
      result.thresholdType,
      result.limitEur,
      result.spentEur,
      projectId
    );
  }
}

// Dedup: only write one alert per project+service+thresholdType per 6-hour window.
async function maybeRecordAlert(
  projectId: string,
  service: string,
  thresholdType: "daily" | "monthly",
  limitEur: number,
  spentEur: number,
  percent: number
): Promise<void> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const [recent] = await db
    .select({ id: costAlerts.id })
    .from(costAlerts)
    .where(
      and(
        eq(costAlerts.projectId, projectId),
        sql`${costAlerts.service} = ${service}`,
        sql`${costAlerts.thresholdType} = ${thresholdType}`,
        gte(costAlerts.createdAt, sixHoursAgo)
      )
    )
    .limit(1);

  if (recent) return;

  await db.insert(costAlerts).values({
    projectId,
    service,
    thresholdType,
    limitEur: limitEur.toFixed(2),
    spentEur: spentEur.toFixed(4),
    percent: Math.round(percent),
  });

  log.warn(
    { projectId, service, thresholdType, percent: Math.round(percent) },
    "Cost alert recorded"
  );

  // Notify owners (warning — in-app only, no Web Push)
  const [project] = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));

  for (const owner of owners) {
    void createNotification({
      userId: owner.id,
      type: "cost_alert",
      severity: "warning",
      title: `Cost alert ${Math.round(percent)}%`,
      message: `${service} ${thresholdType}: € ${spentEur.toFixed(2)} of € ${limitEur.toFixed(2)} (${project?.name ?? projectId})`,
      link: `/cost?projectId=${projectId}`,
      metadata: { projectId, service, thresholdType, percent },
    });
  }
}
