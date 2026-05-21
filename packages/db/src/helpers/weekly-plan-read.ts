// Spec 62.4: read helpers for weekly_plans.
//
// PlannerEngine uses `getActiveWeeklyPlanForWeek` in PersistPlanStep to detect
// re-generation. API routes use `getWeeklyPlanById` + `listWeeklyPlans`.

import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../client.ts";
import { weeklyPlans, type WeeklyPlan } from "../schema/operations.ts";

const TERMINAL_OR_SUPERSEDED: Array<WeeklyPlan["status"]> = ["superseded", "cancelled"];

/**
 * Returns the active plan for one (project, year, iso_week) or null.
 * Active = status NOT IN ('superseded', 'cancelled'). Mirrors the partial
 * unique index `weekly_plans_one_active_per_week`.
 */
export async function getActiveWeeklyPlanForWeek(input: {
  projectId: string;
  year: number;
  isoWeek: number;
}): Promise<WeeklyPlan | null> {
  const rows = await db
    .select()
    .from(weeklyPlans)
    .where(
      and(
        eq(weeklyPlans.projectId, input.projectId),
        eq(weeklyPlans.year, input.year),
        eq(weeklyPlans.isoWeek, input.isoWeek),
        notInArray(weeklyPlans.status, TERMINAL_OR_SUPERSEDED),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getWeeklyPlanById(id: string): Promise<WeeklyPlan | null> {
  const rows = await db.select().from(weeklyPlans).where(eq(weeklyPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface ListWeeklyPlansInput {
  projectId: string;
  year?: number;
  isoWeek?: number;
  statuses?: Array<WeeklyPlan["status"]>;
  limit?: number;
}

export async function listWeeklyPlans(input: ListWeeklyPlansInput): Promise<WeeklyPlan[]> {
  const conditions = [eq(weeklyPlans.projectId, input.projectId)];
  if (input.year !== undefined) conditions.push(eq(weeklyPlans.year, input.year));
  if (input.isoWeek !== undefined) conditions.push(eq(weeklyPlans.isoWeek, input.isoWeek));
  if (input.statuses && input.statuses.length > 0) {
    conditions.push(inArray(weeklyPlans.status, input.statuses));
  }
  return await db
    .select()
    .from(weeklyPlans)
    .where(and(...conditions))
    .orderBy(desc(weeklyPlans.weekStartDate))
    .limit(input.limit ?? 100);
}
