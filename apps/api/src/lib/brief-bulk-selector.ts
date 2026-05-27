/**
 * Spec 64.17 — Bulk-Brief-Action selector.
 *
 * Resolves the discriminated-union body shape used by the bulk Approve/Dismiss
 * endpoints into a concrete array of brief IDs:
 *
 *   { briefIds: string[] }            → pass-through, no DB read
 *   { filter, excludeIds?: string[] } → server-side re-query of topic_briefs
 *                                       using the same WHERE-clause logic as
 *                                       GET /briefs, then subtract excludeIds
 *
 * The filter-shape branch is the race-safety guard (Discovery §4): if Marcel
 * selected "all 168 matching filter" at T0 and cron fires between T0 and the
 * action, the server picks the freshest matching set rather than relying on
 * a frozen client-side list.
 *
 * Also exports `buildBriefsWhere` so GET /briefs and the bulk path share one
 * source of truth for the filter-to-SQL translation.
 */

import { and, eq, inArray, sql, topicBriefs } from "@marketing-auto/db";
import type { SQL } from "drizzle-orm";
import { db } from "@marketing-auto/db";

/**
 * Brief source enum — mirrors `topic_briefs.source` values in
 * packages/db/src/schema/content.ts. Kept here (rather than imported from the
 * DB package) because the GET /briefs route schema uses the same set and we
 * want a single point of truth at the API boundary.
 */
export const BRIEF_SOURCES = [
  "gap_analysis",
  "trend_discovery",
  "refresh_detection",
  "manual",
  "comparison_discovery",
  "release_detection",
  "star_trend",
  "recurring",
] as const;
export type BriefSource = (typeof BRIEF_SOURCES)[number];

/**
 * Approval status groups for section filtering. Spec 63.6: `plan_pending` lives
 * in the `pending` section so BriefsPage chips can filter it via
 * `readiness=plan_ready` without splintering the taxonomy.
 */
type ApprovalStatus =
  | "pending"
  | "plan_pending"
  | "approved"
  | "rejected"
  | "auto_approved"
  | "superseded"
  | "routed";

const PENDING_STATUSES: Array<ApprovalStatus> = ["pending", "plan_pending"];
const IN_FLIGHT_STATUSES: Array<ApprovalStatus> = ["approved", "auto_approved", "routed"];
const DONE_STATUSES: Array<ApprovalStatus> = ["rejected", "superseded"];

export type BriefsSection = "pending" | "in-flight" | "done" | "all";
export type BriefsReadiness = "ready" | "unready" | "plan_ready" | "all";

// `source` / `readiness` accept `| undefined` so Zod-inferred types from the
// route schemas (which produce `field?: T | undefined`) assign cleanly under
// `exactOptionalPropertyTypes`. The runtime checks already guard for both
// "key absent" and "value undefined" identically.
export type BriefsFilter = {
  section: BriefsSection;
  source?: Array<BriefSource> | undefined;
  readiness?: BriefsReadiness | undefined;
};

/**
 * Builds the WHERE-clause array for topic_briefs scoped by project + filter.
 * Shared between GET /briefs and the bulk-selector filter-shape path so the
 * two stay in lockstep. Cursor pagination is intentionally NOT included — it
 * belongs to GET only; bulk actions operate on the full filter-match set
 * (capped at 500 by the selector).
 */
export function buildBriefsWhere(projectId: string, filter: BriefsFilter): Array<SQL> {
  const conditions: Array<SQL> = [eq(topicBriefs.projectId, projectId)];

  if (filter.section === "pending") {
    conditions.push(inArray(topicBriefs.approvalStatus, PENDING_STATUSES));
  } else if (filter.section === "in-flight") {
    conditions.push(inArray(topicBriefs.approvalStatus, IN_FLIGHT_STATUSES));
  } else if (filter.section === "done") {
    conditions.push(inArray(topicBriefs.approvalStatus, DONE_STATUSES));
  }

  if (filter.source && filter.source.length > 0) {
    conditions.push(inArray(topicBriefs.source, filter.source));
  }

  if (filter.readiness === "ready") {
    conditions.push(
      sql`(${topicBriefs.primaryKeyword} IS NOT NULL OR ${topicBriefs.source} = 'comparison_discovery')`,
    );
  } else if (filter.readiness === "unready") {
    conditions.push(
      sql`(${topicBriefs.primaryKeyword} IS NULL AND ${topicBriefs.source} <> 'comparison_discovery')`,
    );
  } else if (filter.readiness === "plan_ready") {
    conditions.push(eq(topicBriefs.approvalStatus, "plan_pending"));
  }

  return conditions;
}

export type BulkBriefSelector =
  | { briefIds: Array<string> }
  | { filter: BriefsFilter; excludeIds?: Array<string> };

export type ResolvedBulkSelection = {
  /** Concrete IDs to process (post-exclude, capped). */
  briefIds: Array<string>;
  /** True when the server re-queried via filter-shape (race-safety surface). */
  reQueried: boolean;
};

/**
 * Hard ceiling on filter-shape resolution. Mirrors the briefIds-array cap so
 * both branches converge on the same operational bound.
 */
const BULK_SELECTION_CAP = 500;

/**
 * Resolves either body shape to a concrete brief-ID array scoped to the
 * project. Multi-tenant invariant: filter-shape always filters by projectId
 * inside buildBriefsWhere; briefIds-shape callers MUST still cross-check
 * project ownership before mutating (the existing bulk handlers do this via
 * the approveBrief / UPDATE-with-projectId-predicate path).
 */
export async function resolveBulkBriefIds(
  projectId: string,
  selector: BulkBriefSelector,
): Promise<ResolvedBulkSelection> {
  if ("briefIds" in selector) {
    return { briefIds: selector.briefIds, reQueried: false };
  }

  const conditions = buildBriefsWhere(projectId, selector.filter);
  const rows = await db
    .select({ id: topicBriefs.id })
    .from(topicBriefs)
    .where(and(...conditions))
    .limit(BULK_SELECTION_CAP);

  const excluded = new Set(selector.excludeIds ?? []);
  const briefIds = rows.map((r) => r.id).filter((id) => !excluded.has(id));

  return { briefIds, reQueried: true };
}
