/**
 * Spec 65.1 — recurring_content_definitions read helpers.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type RecurringContentDefinition,
  recurringContentDefinitions,
} from "../schema/recurring-content-definitions.ts";

export async function getRecurringDefinition(
  id: string
): Promise<RecurringContentDefinition | null> {
  const rows = await db
    .select()
    .from(recurringContentDefinitions)
    .where(eq(recurringContentDefinitions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRecurringDefinitions(filters: {
  projectId: string;
  formatType?: string;
  includeInactive?: boolean;
}): Promise<RecurringContentDefinition[]> {
  const conditions = [eq(recurringContentDefinitions.projectId, filters.projectId)];
  if (!filters.includeInactive) {
    conditions.push(eq(recurringContentDefinitions.isActive, true));
  }
  if (filters.formatType !== undefined) {
    conditions.push(eq(recurringContentDefinitions.formatType, filters.formatType));
  }
  return await db
    .select()
    .from(recurringContentDefinitions)
    .where(and(...conditions))
    .orderBy(asc(recurringContentDefinitions.nextRunAt));
}

/**
 * Cron-coordinator read: rows that are active AND due. Per Memory D24 we add
 * a 30-second age buffer (`created_at < NOW() - 30s`) so freshly-INSERTed
 * rows don't fire during the same tick they were created in — avoids races
 * with the API setting `next_run_at = NOW()` for a manual one-off trigger.
 *
 * Stable secondary sort by id ensures deterministic order when multiple rows
 * share the same `next_run_at` (e.g. seeded in bulk at onboarding).
 */
export async function listDueRecurringDefinitions(opts?: {
  limit?: number;
}): Promise<RecurringContentDefinition[]> {
  const limit = opts?.limit ?? 10;
  return await db
    .select()
    .from(recurringContentDefinitions)
    .where(
      and(
        eq(recurringContentDefinitions.isActive, true),
        lte(recurringContentDefinitions.nextRunAt, new Date()),
        sql`${recurringContentDefinitions.createdAt} < NOW() - INTERVAL '30 seconds'`
      )
    )
    .orderBy(asc(recurringContentDefinitions.nextRunAt), asc(recurringContentDefinitions.id))
    .limit(limit);
}
