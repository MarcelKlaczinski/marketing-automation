/**
 * Spec 64.21 — inventory star-history write helpers.
 *
 * Three operations:
 *   - `insertStarSnapshot()` — append one row per successful inventory refresh
 *   - `pruneStarSnapshots()` — bulk-delete rows older than a cutoff (cron end-of-tick)
 *   - `queryStarsAgo()` — read the most-recent snapshot at-or-before `cutoff`
 *                         (used by the detect module to compute prior-vs-current delta)
 *
 * Same separation of concerns as the existing inventory helpers:
 * `content-source-inventory-{read,write}.ts`. Kept in their own file because
 * star-history is a different table with its own lifecycle.
 */

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../client.ts";
import { inventoryStarHistory } from "../schema/content.ts";

export interface InsertStarSnapshotInput {
  projectId:    string;
  inventoryId:  string;
  starsCount:   number;
  /** Defaults to NOW(). Override only in tests that need a deterministic
   *  timestamp; production callers (the cron worker) always use NOW(). */
  snapshotAt?:  Date;
}

export async function insertStarSnapshot(input: InsertStarSnapshotInput): Promise<string> {
  if (input.starsCount < 0 || !Number.isFinite(input.starsCount)) {
    throw new Error(`insertStarSnapshot: starsCount must be a non-negative integer (got ${input.starsCount})`);
  }
  const [row] = await db
    .insert(inventoryStarHistory)
    .values({
      projectId:   input.projectId,
      inventoryId: input.inventoryId,
      starsCount:  Math.trunc(input.starsCount),
      ...(input.snapshotAt && { snapshotAt: input.snapshotAt }),
    })
    .returning({ id: inventoryStarHistory.id });
  if (!row) {
    throw new Error("insertStarSnapshot: INSERT returned no row");
  }
  return row.id;
}

/**
 * Returns the most-recent snapshot at-or-before `cutoff`, or `null` if no
 * snapshot exists within history (e.g. the inventory row has never been
 * refreshed long enough for a baseline to exist).
 *
 * The "at-or-before" semantics is intentional: with a weekly refresh cadence
 * and a 30-day window, the nearest snapshot may be a few days off the exact
 * cutoff. The DESC ordering returns the freshest candidate that still meets
 * the predicate — closer to the cutoff than any older snapshot.
 */
export async function queryStarsAgo(
  inventoryId: string,
  cutoff: Date,
): Promise<{ starsCount: number; snapshotAt: Date } | null> {
  const rows = await db
    .select({
      starsCount: inventoryStarHistory.starsCount,
      snapshotAt: inventoryStarHistory.snapshotAt,
    })
    .from(inventoryStarHistory)
    .where(
      and(
        eq(inventoryStarHistory.inventoryId, inventoryId),
        // sql template requires .toISOString() — Memory rule on Date binding.
        sql`${inventoryStarHistory.snapshotAt} <= ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(inventoryStarHistory.snapshotAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the number of rows deleted. The cutoff is exclusive — rows whose
 * `snapshotAt < cutoff` are deleted; rows at exactly the cutoff are kept.
 * Caller decides retention (worker uses NOW - 90 days).
 */
export async function pruneStarSnapshots(cutoff: Date): Promise<number> {
  const rows = await db
    .delete(inventoryStarHistory)
    .where(lt(inventoryStarHistory.snapshotAt, cutoff))
    .returning({ id: inventoryStarHistory.id });
  return rows.length;
}
