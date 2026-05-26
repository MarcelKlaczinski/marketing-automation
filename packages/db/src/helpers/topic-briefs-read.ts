/**
 * Spec 65.11 — topic_briefs read helpers for the Settings UI history view.
 *
 * Recurring-definition consumers read `topic_briefs` filtered by the
 * `recurring_metadata->>'definitionId'` jsonb path. The column is jsonb (not
 * relational) so the query uses a `->>` projection — adequate at Toolwiki
 * scale where one definition produces ~52 briefs/year.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../client.ts";
import { type TopicBrief, topicBriefs } from "../schema/content.ts";

export interface ListByRecurringDefinitionInput {
  projectId: string;
  definitionId: string;
  /** Default: 50, max: 500. */
  limit?: number;
  /** Default: 0. */
  offset?: number;
  /** Default: descending by createdAt (newest first). */
  order?: "asc" | "desc";
}

export async function listTopicBriefsByRecurringDefinitionId(
  input: ListByRecurringDefinitionInput,
): Promise<TopicBrief[]> {
  const limit = Math.min(input.limit ?? 50, 500);
  const offset = input.offset ?? 0;
  const orderClause =
    input.order === "asc" ? asc(topicBriefs.createdAt) : desc(topicBriefs.createdAt);
  return await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, input.projectId),
        eq(topicBriefs.source, "recurring"),
        sql`${topicBriefs.recurringMetadata}->>'definitionId' = ${input.definitionId}`,
      ),
    )
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset);
}

export async function countTopicBriefsByRecurringDefinitionId(input: {
  projectId: string;
  definitionId: string;
}): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, input.projectId),
        eq(topicBriefs.source, "recurring"),
        sql`${topicBriefs.recurringMetadata}->>'definitionId' = ${input.definitionId}`,
      ),
    );
  return rows[0]?.count ?? 0;
}
