/**
 * Spec 65.1 — template_usage_log write helpers.
 *
 * Per Marcel-Decision Q3 the table is capped at 50 entries per definition.
 * `pruneTemplateUsageLog` enforces the cap for a single definition;
 * `pruneAllTemplateUsageLog` iterates across every distinct definition (used
 * by the daily auto-prune cron at apps/api/src/workers/template-usage-log-prune.cron.ts).
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type NewTemplateUsageLog,
  type TemplateUsageLog,
  templateUsageLog,
} from "../schema/template-usage-log.ts";

export async function logTemplateUsage(input: NewTemplateUsageLog): Promise<TemplateUsageLog> {
  const rows = await db.insert(templateUsageLog).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("logTemplateUsage: INSERT returned no row");
  return row;
}

/**
 * Keep only the `keepLastN` most-recent entries for one definition. Returns
 * the number of rows deleted.
 *
 * Implementation: SELECT the IDs to keep (newest N), then DELETE everything
 * else scoped to the same definition. Two-step is necessary because
 * PostgreSQL `DELETE ... NOT IN (subquery)` against the same table requires
 * either a CTE or a separate read — Drizzle's surface is happier with the
 * read-then-delete shape and the cost is identical (one extra round-trip
 * per definition; called once per definition per day by the auto-prune cron).
 *
 * No-op (returns 0) when the definition already has ≤ keepLastN entries.
 */
export async function pruneTemplateUsageLog(input: {
  recurringDefinitionId: string;
  keepLastN?: number;
}): Promise<number> {
  const keepLastN = input.keepLastN ?? 50;
  if (keepLastN < 0) {
    throw new Error("pruneTemplateUsageLog: keepLastN must be >= 0");
  }
  const keepRows = await db
    .select({ id: templateUsageLog.id })
    .from(templateUsageLog)
    .where(eq(templateUsageLog.recurringDefinitionId, input.recurringDefinitionId))
    .orderBy(desc(templateUsageLog.usedAt))
    .limit(keepLastN);
  const keepIds = keepRows.map((r) => r.id);

  if (keepIds.length === 0) {
    // Nothing to keep — delete every row for this definition.
    const deletedAll = await db
      .delete(templateUsageLog)
      .where(eq(templateUsageLog.recurringDefinitionId, input.recurringDefinitionId))
      .returning({ id: templateUsageLog.id });
    return deletedAll.length;
  }

  const deleted = await db
    .delete(templateUsageLog)
    .where(
      sql`${templateUsageLog.recurringDefinitionId} = ${input.recurringDefinitionId} AND ${templateUsageLog.id} NOT IN (${sql.join(
        keepIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    .returning({ id: templateUsageLog.id });
  return deleted.length;
}

/**
 * Cron-runnable: prune every distinct definition. Returns aggregate stats so
 * the cron log surfaces "N definitions touched, M rows deleted" per tick.
 *
 * Reads distinct definition IDs first, then iterates with `pruneTemplateUsageLog`.
 * Per-definition isolation keeps any single definition's failure from blocking
 * the rest of the sweep — though current implementation is best-effort
 * sequential, an early throw would still abort the loop. 65.1 ships the simple
 * version; 65.5/65.6 may upgrade to per-definition try/catch if scale demands.
 */
export async function pruneAllTemplateUsageLog(opts?: {
  keepLastN?: number;
}): Promise<{ definitionsPruned: number; rowsDeleted: number }> {
  const keepLastN = opts?.keepLastN ?? 50;
  const distinctRows = await db
    .selectDistinct({ id: templateUsageLog.recurringDefinitionId })
    .from(templateUsageLog);
  let definitionsPruned = 0;
  let rowsDeleted = 0;
  for (const { id } of distinctRows) {
    const deleted = await pruneTemplateUsageLog({
      recurringDefinitionId: id,
      keepLastN,
    });
    if (deleted > 0) {
      definitionsPruned += 1;
      rowsDeleted += deleted;
    }
  }
  return { definitionsPruned, rowsDeleted };
}
