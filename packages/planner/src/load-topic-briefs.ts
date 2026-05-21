// Spec 62.4: load the pending-brief queue for one project, in FIFO order.
//
// The planner consumes `topic_briefs` rows in `approval_status IN ('pending',
// 'plan_pending')` AND `source` in the known-handled set. The explicit source
// filter is defensive: if a future migration adds a new source enum value (say
// `competitive_alert`), planner-side code wouldn't know how to bucket it,
// so we'd rather silently exclude than mis-handle. SelectFloorItemsStep's
// `matchBriefToContentType` is the single source of truth for routing
// sources → content types — keep `PLANNER_HANDLED_SOURCES` in sync with it.
//
// Spec 63.6: `plan_pending` briefs (Marcel approved through BriefsPage with
// dispatch='plan') sort BEFORE bare `pending` briefs because Marcel explicitly
// vouched for them. Within each bucket FIFO by created_at — preserves the
// spec §4.2.5 ("first N candidates in FIFO order") behaviour.

import {
  and,
  asc,
  db,
  eq,
  inArray,
  sql,
  topicBriefs,
  type TopicBrief,
} from "@marketing-auto/db";

/**
 * Brief sources the planner knows how to route. Keep in sync with the
 * `topic_briefs_source_check` constraint (migration 0073) and with
 * `matchBriefToContentType` in packages/pipelines/src/planning/steps/
 * select-floor-items.ts.
 */
export const PLANNER_HANDLED_SOURCES = [
  "gap_analysis",
  "trend_discovery",
  "refresh_detection",
  "manual",
  "comparison_discovery",
] as const;
export type PlannerHandledSource = (typeof PLANNER_HANDLED_SOURCES)[number];

export interface LoadPendingTopicBriefsInput {
  projectId: string;
  /** Hard cap to avoid runaway loads. Default: 1000 (planner only ever needs ~50). */
  limit?: number;
}

export async function loadPendingTopicBriefs(
  input: LoadPendingTopicBriefsInput,
): Promise<TopicBrief[]> {
  // Spec 63.6: 'plan_pending' (Marcel explicitly approved) sorts before bare
  // 'pending' (trend-synthesizer / gap-analysis auto-output). FIFO within
  // each bucket via created_at ASC tiebreaker.
  const statusBuckets: Array<TopicBrief["approvalStatus"]> = ["pending", "plan_pending"];
  return await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, input.projectId),
        inArray(topicBriefs.approvalStatus, statusBuckets),
        // Spread to mutable array — Drizzle `inArray()` rejects `as const`
        // tuples (see workspace CLAUDE.md "DO NOT pass an `as const` tuple to
        // Drizzle's inArray").
        inArray(topicBriefs.source, [...PLANNER_HANDLED_SOURCES]),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${topicBriefs.approvalStatus} = 'plan_pending' THEN 0 ELSE 1 END`,
      asc(topicBriefs.createdAt),
    )
    .limit(input.limit ?? 1000);
}
