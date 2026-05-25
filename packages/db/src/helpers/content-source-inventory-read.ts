import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../client.ts";
import {
  contentSourceInventory,
  type ContentSourceInventory,
  type InventoryFetchStatus,
  type InventoryObjectType,
} from "../schema/content.ts";

/**
 * Spec 64.20: list inventory rows for a project, optionally filtered by object-type +
 * fetch-status. `approvedOnly` defaults to true — list views in Settings-UI show only
 * approved (V1: pre-approved via Marcel-Seed; V1.1: Auto-Discovery candidates with
 * approvedAt IS NULL surface via a separate "review queue").
 */
export interface ListInventoryByProjectInput {
  projectId: string;
  objectType?: InventoryObjectType;
  fetchStatus?: InventoryFetchStatus;
  approvedOnly?: boolean;
}

export async function listInventoryByProject(
  input: ListInventoryByProjectInput,
): Promise<ContentSourceInventory[]> {
  const conditions = [eq(contentSourceInventory.projectId, input.projectId)];
  if (input.objectType) conditions.push(eq(contentSourceInventory.objectType, input.objectType));
  if (input.fetchStatus) conditions.push(eq(contentSourceInventory.fetchStatus, input.fetchStatus));
  if (input.approvedOnly !== false) conditions.push(isNotNull(contentSourceInventory.approvedAt));

  return db
    .select()
    .from(contentSourceInventory)
    .where(and(...conditions))
    .orderBy(asc(contentSourceInventory.displayName));
}

export async function getInventoryById(id: string): Promise<ContentSourceInventory | null> {
  const rows = await db
    .select()
    .from(contentSourceInventory)
    .where(eq(contentSourceInventory.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Spec 64.20: rows the cron worker should fetch on the next tick.
 *
 * Predicate (mirrors the partial index `csi_due_for_refresh_idx`):
 *   - approved_at IS NOT NULL
 *   - fetch_status IN ('ok','pending')   — actively-fetching rows skipped
 *   - last_fetched_at IS NULL  OR  now() - last_fetched_at >= refresh_interval_hours
 *
 * Plus a transactional `ageBufferSeconds` (default 0) — useful when the cron tick
 * is co-located with INSERT paths and we want to give freshly-inserted rows a
 * grace window. Mirrors `SUBMIT_AGE_BUFFER_MS` from Spec 64.7 §image-batch.
 */
export interface ListInventoryDueForRefreshInput {
  /** Optional project filter — if omitted the worker scans across all tenants. */
  projectId?: string;
  /** Max rows returned (batch size per worker tick). */
  limit: number;
  /** Seconds since createdAt before a row is eligible (race buffer). 0 = no buffer. */
  ageBufferSeconds?: number;
}

export async function listInventoryDueForRefresh(
  input: ListInventoryDueForRefreshInput,
): Promise<ContentSourceInventory[]> {
  const eligibleStatuses: InventoryFetchStatus[] = ["ok", "pending"];

  const conditions = [
    isNotNull(contentSourceInventory.approvedAt),
    inArray(contentSourceInventory.fetchStatus, eligibleStatuses),
    sql`(${contentSourceInventory.lastFetchedAt} IS NULL OR ${contentSourceInventory.lastFetchedAt} < NOW() - (${contentSourceInventory.refreshIntervalHours} || ' hours')::interval)`,
  ];

  if (input.projectId) {
    conditions.push(eq(contentSourceInventory.projectId, input.projectId));
  }

  if (input.ageBufferSeconds && input.ageBufferSeconds > 0) {
    conditions.push(
      lt(
        contentSourceInventory.createdAt,
        new Date(Date.now() - input.ageBufferSeconds * 1000),
      ),
    );
  }

  return db
    .select()
    .from(contentSourceInventory)
    .where(and(...conditions))
    .orderBy(sql`${contentSourceInventory.lastFetchedAt} ASC NULLS FIRST`)
    .limit(input.limit);
}

/**
 * Settings-UI summary card: count of rows per object-type for a project.
 */
export interface InventoryCountByObjectType {
  tool: number;
  skill: number;
}

export async function countByObjectType(projectId: string): Promise<InventoryCountByObjectType> {
  const rows = await db
    .select({
      objectType: contentSourceInventory.objectType,
      count: sql<number>`count(*)::int`,
    })
    .from(contentSourceInventory)
    .where(
      and(
        eq(contentSourceInventory.projectId, projectId),
        isNotNull(contentSourceInventory.approvedAt),
      ),
    )
    .groupBy(contentSourceInventory.objectType);

  const result: InventoryCountByObjectType = { tool: 0, skill: 0 };
  for (const row of rows) {
    if (row.objectType === "tool") result.tool = row.count;
    else if (row.objectType === "skill") result.skill = row.count;
  }
  return result;
}
