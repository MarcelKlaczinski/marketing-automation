/**
 * Spec 65.1 — hook_templates read helpers.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type HookDramaIntensity,
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
 *
 * Spec 65.14 — optional `dramaIntensities` allow-list narrows the pool to
 * the intensities the caller wants. The picker derives the allow-list from
 * `recurring_content_definitions.outputTargets`: article-only callers pass
 * `['subtle']` (Spec 64.16 compliance), social callers pass all three.
 * SQL-level pre-filter beats post-check (Spec 65.5-followup pattern) — the
 * LLM never sees pool members it isn't allowed to pick. Empty array is
 * rejected (would silently return zero rows); omit the param to skip.
 */
export async function listLruEligibleHooks(filters: {
  projectId: string;
  formatType: string;
  language: HookTemplateLanguage;
  limit?: number;
  dramaIntensities?: HookDramaIntensity[];
}): Promise<HookTemplate[]> {
  const limit = filters.limit ?? 10;
  if (filters.dramaIntensities !== undefined && filters.dramaIntensities.length === 0) {
    throw new Error(
      "listLruEligibleHooks: dramaIntensities must be undefined or non-empty (empty array would silently return zero rows)",
    );
  }
  const conditions = [
    eq(hookTemplates.projectId, filters.projectId),
    eq(hookTemplates.formatType, filters.formatType),
    eq(hookTemplates.language, filters.language),
    eq(hookTemplates.isActive, true),
  ];
  if (filters.dramaIntensities !== undefined) {
    // Drizzle inArray requires a mutable array of the underlying column type;
    // spread keeps the call-site allow-list intact.
    const intensities: HookDramaIntensity[] = [...filters.dramaIntensities];
    conditions.push(inArray(hookTemplates.dramaIntensity, intensities));
  }
  return await db
    .select()
    .from(hookTemplates)
    .where(and(...conditions))
    .orderBy(
      sql`${hookTemplates.lastUsedAt} ASC NULLS FIRST`,
      asc(hookTemplates.usageCount),
      asc(hookTemplates.id)
    )
    .limit(limit);
}
