/**
 * Spec 65.1 — recurring_content_definitions write helpers.
 */
import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type NewRecurringContentDefinition,
  type RecurringContentDefinition,
  recurringContentDefinitions,
} from "../schema/recurring-content-definitions.ts";

export async function createRecurringDefinition(
  input: NewRecurringContentDefinition
): Promise<RecurringContentDefinition> {
  const rows = await db.insert(recurringContentDefinitions).values(input).returning();
  const row = rows[0];
  if (!row) {
    throw new Error("createRecurringDefinition: INSERT returned no row");
  }
  return row;
}

/**
 * PATCH editable fields. Server-managed columns (id, createdAt) are silently
 * dropped by Drizzle when not present in the SET clause.
 */
export async function updateRecurringDefinition(
  id: string,
  patch: Partial<NewRecurringContentDefinition>
): Promise<RecurringContentDefinition | null> {
  const rows = await db
    .update(recurringContentDefinitions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(recurringContentDefinitions.id, id))
    .returning();
  return rows[0] ?? null;
}

/**
 * Cron-coordinator write — atomically stamp last_run_at + advance next_run_at.
 * Called by the 65.5 Brief-Generator worker right after dispatch.
 *
 * Returns nothing because the caller already has the row and only needs the
 * stamp to land; ignoring the return keeps the hot-path concise.
 */
export async function markRecurringDefinitionRun(
  id: string,
  opts: { newNextRunAt: Date; lastRunAt?: Date }
): Promise<void> {
  await db
    .update(recurringContentDefinitions)
    .set({
      nextRunAt: opts.newNextRunAt,
      lastRunAt: opts.lastRunAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(recurringContentDefinitions.id, id));
}

export async function setRecurringDefinitionActive(id: string, isActive: boolean): Promise<void> {
  await db
    .update(recurringContentDefinitions)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(recurringContentDefinitions.id, id));
}
