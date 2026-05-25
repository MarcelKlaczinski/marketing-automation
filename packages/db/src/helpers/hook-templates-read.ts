/**
 * Spec 65.1 — hook_templates read helpers.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type HookTemplate,
  type HookTemplateLanguage,
  hookTemplates,
} from "../schema/hook-templates.ts";

export async function getHookTemplate(id: string): Promise<HookTemplate | null> {
  const rows = await db.select().from(hookTemplates).where(eq(hookTemplates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listHookTemplates(filters: {
  projectId: string;
  formatType?: string;
  language?: HookTemplateLanguage;
  includeInactive?: boolean;
}): Promise<HookTemplate[]> {
  const conditions = [eq(hookTemplates.projectId, filters.projectId)];
  if (!filters.includeInactive) {
    conditions.push(eq(hookTemplates.isActive, true));
  }
  if (filters.formatType !== undefined) {
    conditions.push(eq(hookTemplates.formatType, filters.formatType));
  }
  if (filters.language !== undefined) {
    conditions.push(eq(hookTemplates.language, filters.language));
  }
  return await db
    .select()
    .from(hookTemplates)
    .where(and(...conditions))
    .orderBy(asc(hookTemplates.createdAt));
}

/**
 * LRU read for the 65.4 Hook-Picker: ORDER BY last_used_at NULLS FIRST,
 * usage_count ASC so never-used hooks bubble up first, then least-used among
 * the previously-used. Stable secondary sort by id keeps deterministic
 * ordering across tests + ties.
 */
export async function listLruEligibleHooks(filters: {
  projectId: string;
  formatType: string;
  language: HookTemplateLanguage;
  limit?: number;
}): Promise<HookTemplate[]> {
  const limit = filters.limit ?? 10;
  return await db
    .select()
    .from(hookTemplates)
    .where(
      and(
        eq(hookTemplates.projectId, filters.projectId),
        eq(hookTemplates.formatType, filters.formatType),
        eq(hookTemplates.language, filters.language),
        eq(hookTemplates.isActive, true)
      )
    )
    .orderBy(
      sql`${hookTemplates.lastUsedAt} ASC NULLS FIRST`,
      asc(hookTemplates.usageCount),
      asc(hookTemplates.id)
    )
    .limit(limit);
}
