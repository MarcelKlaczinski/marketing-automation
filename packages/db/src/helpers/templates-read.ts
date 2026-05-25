/**
 * Spec 65.0 — Template Engine read helpers.
 */
import { db } from "../client.ts";
import { templates, type Template } from "../schema/templates.ts";
import { and, eq, isNull, or, sql } from "drizzle-orm";

/**
 * Fetch the active row for a template_key in a given project's scope.
 * Resolution order: project-scoped row first, falling back to a global row
 * (project_id IS NULL) when no project-scoped row exists. Returns null when
 * neither is found.
 */
export async function getTemplate(opts: {
  projectId: string;
  templateKey: string;
}): Promise<Template | null> {
  // Single query covers both scopes; ORDER BY project_id desc-nulls-last so
  // the project-scoped row wins when both exist.
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.templateKey, opts.templateKey),
        eq(templates.isActive, true),
        or(eq(templates.projectId, opts.projectId), isNull(templates.projectId)),
      ),
    )
    .orderBy(sql`${templates.projectId} IS NULL`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * List active templates in a project's scope (global + project-scoped).
 * Optional `formatType` filter uses the GIN-indexed `format_types` column.
 */
export async function listActiveTemplates(opts: {
  projectId: string;
  formatType?: string;
}): Promise<Template[]> {
  const conditions = [
    eq(templates.isActive, true),
    or(eq(templates.projectId, opts.projectId), isNull(templates.projectId)),
  ];
  if (opts.formatType !== undefined) {
    conditions.push(sql`${opts.formatType} = ANY(${templates.formatTypes})`);
  }
  return await db
    .select()
    .from(templates)
    .where(and(...conditions))
    .orderBy(templates.templateKey);
}

/**
 * List ALL active globals — used at startup when there's no project context
 * yet (e.g. admin tooling, settings preview before project selection).
 */
export async function listActiveGlobalTemplates(): Promise<Template[]> {
  return await db
    .select()
    .from(templates)
    .where(and(isNull(templates.projectId), eq(templates.isActive, true)))
    .orderBy(templates.templateKey);
}
