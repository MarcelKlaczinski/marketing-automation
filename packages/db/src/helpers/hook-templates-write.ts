/**
 * Spec 65.1 — hook_templates write helpers.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type HookTemplate,
  type NewHookTemplate,
  hookTemplates,
} from "../schema/hook-templates.ts";

export async function createHookTemplate(input: NewHookTemplate): Promise<HookTemplate> {
  const rows = await db.insert(hookTemplates).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("createHookTemplate: INSERT returned no row");
  return row;
}

/**
 * Atomic LRU bump — usage_count++ + last_used_at = NOW(). Fire-and-forget
 * from the 65.4 Hook-Picker hot-path after a hook is selected.
 */
export async function markHookUsed(id: string): Promise<void> {
  await db
    .update(hookTemplates)
    .set({
      usageCount: sql`${hookTemplates.usageCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(eq(hookTemplates.id, id));
}

export async function setHookTemplateActive(id: string, isActive: boolean): Promise<void> {
  await db.update(hookTemplates).set({ isActive }).where(eq(hookTemplates.id, id));
}
