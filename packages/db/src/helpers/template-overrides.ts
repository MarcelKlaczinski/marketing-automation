import { db } from "../client.ts";
import { projectTemplateOverrides } from "../schema/social-overrides.ts";
import { and, eq, isNull, lt, or } from "drizzle-orm";

/**
 * Fetch the override row for a project + templateKey.
 * Returns null when no row exists (caller should fall through to schema defaults).
 */
export async function fetchTemplateOverrides(
  projectId: string,
  templateKey: string,
): Promise<{ values: Record<string, unknown> } | null> {
  const rows = await db
    .select({ values: projectTemplateOverrides.values })
    .from(projectTemplateOverrides)
    .where(
      and(
        eq(projectTemplateOverrides.projectId, projectId),
        eq(projectTemplateOverrides.templateKey, templateKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Approximated last-used-at update.
 * Only writes when existing lastUsedAt is older than 1 hour or null.
 * No-op when no override row exists (project uses defaults — nothing to mark).
 */
export async function markTemplateOverrideUsed(
  projectId: string,
  templateKey: string,
): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  await db
    .update(projectTemplateOverrides)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(projectTemplateOverrides.projectId, projectId),
        eq(projectTemplateOverrides.templateKey, templateKey),
        or(
          isNull(projectTemplateOverrides.lastUsedAt),
          lt(projectTemplateOverrides.lastUsedAt, oneHourAgo),
        ),
      ),
    );
}
