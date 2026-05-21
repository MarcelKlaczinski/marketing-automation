// Spec 62.4: read helpers for planned_items.

import { asc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { plannedItems, type PlannedItem } from "../schema/operations.ts";

export async function listPlannedItemsByPlan(planId: string): Promise<PlannedItem[]> {
  return await db
    .select()
    .from(plannedItems)
    .where(eq(plannedItems.weeklyPlanId, planId))
    .orderBy(asc(plannedItems.slotDate), asc(plannedItems.contentType));
}

export async function getPlannedItemById(itemId: string): Promise<PlannedItem | null> {
  const rows = await db
    .select()
    .from(plannedItems)
    .where(eq(plannedItems.id, itemId))
    .limit(1);
  return rows[0] ?? null;
}
