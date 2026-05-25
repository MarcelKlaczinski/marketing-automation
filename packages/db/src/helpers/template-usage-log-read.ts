/**
 * Spec 65.1 — template_usage_log read helpers.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { type TemplateUsageLog, templateUsageLog } from "../schema/template-usage-log.ts";

/**
 * Returns the most-recent `limit` usage rows for a definition. Drives the
 * 65.6 LRU picker's "what did we use recently" lookup.
 */
export async function listRecentTemplateUsage(input: {
  recurringDefinitionId: string;
  limit?: number;
}): Promise<TemplateUsageLog[]> {
  const limit = input.limit ?? 10;
  return await db
    .select()
    .from(templateUsageLog)
    .where(eq(templateUsageLog.recurringDefinitionId, input.recurringDefinitionId))
    .orderBy(desc(templateUsageLog.usedAt))
    .limit(limit);
}
