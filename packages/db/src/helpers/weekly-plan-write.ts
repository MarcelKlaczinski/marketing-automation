// Spec 62.4: write helpers for weekly_plans + planned_items.
//
// `persistWeeklyPlan` is the canonical insertion path used by PersistPlanStep:
// optionally supersedes the prior active row, INSERTs the new plan, INSERTs
// all planned_items, and returns the new plan + items — all inside one
// transaction so a mid-write failure rolls everything back. Mirrors the
// "PUT replace = full state must be transactional" rule from
// `replaceProjectGoals` in `project-goal-write.ts`.

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, type Transaction } from "../client.ts";
import {
  plannedItems,
  type NewPlannedItem,
  type NewWeeklyPlan,
  type PlannedItem,
  type WeeklyPlan,
  weeklyPlans,
} from "../schema/operations.ts";

const TERMINAL_OR_SUPERSEDED: Array<WeeklyPlan["status"]> = ["superseded", "cancelled"];

export interface PersistWeeklyPlanInput {
  plan: NewWeeklyPlan;
  /** planned_items WITHOUT weeklyPlanId — that's filled in by this helper. */
  items: Array<Omit<NewPlannedItem, "weeklyPlanId">>;
  /**
   * Whether to supersede an existing active plan for the same (project, year, week).
   * - false (default): throws PlanAlreadyExistsError if active row exists.
   * - true: marks the existing active row as 'superseded' and inserts the new one.
   */
  supersedeExisting?: boolean;
}

export interface PersistWeeklyPlanResult {
  plan: WeeklyPlan;
  items: PlannedItem[];
  supersededId: string | null;
}

/**
 * Marker error so callers (route handlers) can map to HTTP 409 without parsing
 * generic exception messages. Thrown when `supersedeExisting=false` finds an
 * active plan for the target (project, year, week).
 */
export class PlanAlreadyExistsError extends Error {
  readonly existingPlanId: string;
  constructor(existingPlanId: string) {
    super(`Active plan already exists: ${existingPlanId}`);
    this.name = "PlanAlreadyExistsError";
    this.existingPlanId = existingPlanId;
  }
}

export async function persistWeeklyPlan(
  input: PersistWeeklyPlanInput,
): Promise<PersistWeeklyPlanResult> {
  return db.transaction(async (tx) => persistWeeklyPlanInTx(tx, input));
}

/**
 * Same as `persistWeeklyPlan` but runs inside a transaction supplied by the caller.
 * Use when the caller already has a transaction open (e.g. PersistPlanStep
 * coordinating with idempotency-cache writes).
 */
export async function persistWeeklyPlanInTx(
  tx: Transaction,
  input: PersistWeeklyPlanInput,
): Promise<PersistWeeklyPlanResult> {
  const { plan, items, supersedeExisting = false } = input;

  // 1. Probe for an existing active plan (matches the partial unique index).
  const existingRows = await tx
    .select({ id: weeklyPlans.id })
    .from(weeklyPlans)
    .where(
      and(
        eq(weeklyPlans.projectId, plan.projectId),
        eq(weeklyPlans.year, plan.year),
        eq(weeklyPlans.isoWeek, plan.isoWeek),
        notInArray(weeklyPlans.status, TERMINAL_OR_SUPERSEDED),
      ),
    )
    .limit(1);

  const existingId = existingRows[0]?.id ?? null;
  if (existingId !== null && !supersedeExisting) {
    throw new PlanAlreadyExistsError(existingId);
  }

  // 2. Supersede the prior plan FIRST so the partial unique index
  // `weekly_plans_one_active_per_week` doesn't trip during INSERT. The index
  // treats `superseded`/`cancelled` rows as inactive, so flipping the old row
  // out of the active set clears the way for the new one. `supersededBy` is
  // filled in step 4 once we know the new id.
  if (existingId !== null) {
    await tx
      .update(weeklyPlans)
      .set({
        status: "superseded",
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(weeklyPlans.id, existingId));
  }

  // 3. INSERT new plan.
  const [newPlan] = await tx.insert(weeklyPlans).values(plan).returning();
  if (!newPlan) {
    throw new Error("persistWeeklyPlan: INSERT returned no row");
  }

  // 4. INSERT planned_items. Empty array is allowed (planner may produce 0
  // items when topic_briefs queue is empty for every goal).
  let newItems: PlannedItem[] = [];
  if (items.length > 0) {
    const itemsToInsert: NewPlannedItem[] = items.map((it) => ({
      ...it,
      weeklyPlanId: newPlan.id,
    }));
    newItems = await tx.insert(plannedItems).values(itemsToInsert).returning();
  }

  // 5. Back-fill the supersededBy pointer now that the new row exists.
  if (existingId !== null) {
    await tx
      .update(weeklyPlans)
      .set({ supersededBy: newPlan.id })
      .where(eq(weeklyPlans.id, existingId));
  }

  return { plan: newPlan, items: newItems, supersededId: existingId };
}

/**
 * PATCH /plans/:planId — status transitions only. Allowed transitions in 62.4:
 *   draft → approved        (sets approvedAt/approvedBy)
 *   draft → cancelled
 *   approved → cancelled
 *
 * Other transitions (running/completed/partially_failed) are owned by the
 * executor in 62.8, not this helper. Returns the updated row or null when the
 * transition is invalid or the row doesn't exist.
 */
export async function transitionWeeklyPlanStatus(input: {
  planId: string;
  toStatus: "approved" | "cancelled";
  approvedBy?: string;
}): Promise<WeeklyPlan | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, input.planId))
      .limit(1);
    if (!current) return null;

    if (input.toStatus === "approved" && current.status !== "draft") return null;
    if (
      input.toStatus === "cancelled" &&
      current.status !== "draft" &&
      current.status !== "approved"
    ) {
      return null;
    }

    const patch: Partial<NewWeeklyPlan> = {
      status: input.toStatus,
      updatedAt: new Date(),
    };
    if (input.toStatus === "approved") {
      patch.approvedAt = new Date();
      if (input.approvedBy !== undefined) patch.approvedBy = input.approvedBy;
    }

    const [updated] = await tx
      .update(weeklyPlans)
      .set(patch)
      .where(eq(weeklyPlans.id, input.planId))
      .returning();
    return updated ?? null;
  });
}

/** Used by integration tests / cleanup scripts. Cascades to planned_items. */
export async function deleteWeeklyPlan(planId: string): Promise<void> {
  await db.delete(weeklyPlans).where(eq(weeklyPlans.id, planId));
}

// ─── planned_items writes ─────────────────────────────────────────────────────

/**
 * Cancel one planned_item (pre-execution only — pending or enqueued status).
 * Returns the updated row or null when the item doesn't exist or is already
 * past the point where cancel is meaningful.
 */
export async function cancelPlannedItem(itemId: string): Promise<PlannedItem | null> {
  const allowed: Array<PlannedItem["status"]> = ["pending", "enqueued"];
  const [updated] = await db
    .update(plannedItems)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(plannedItems.id, itemId), inArray(plannedItems.status, allowed)))
    .returning();
  return updated ?? null;
}

/**
 * Used at the start of an item's BullMQ job (62.8). Returns true if the
 * status flip was applied, false if the row was already past 'pending'
 * (idempotent: a stale enqueue won't clobber an item already in_progress).
 */
export async function markPlannedItemEnqueued(input: {
  itemId: string;
  pipelineRunId: string;
}): Promise<boolean> {
  const result = await db
    .update(plannedItems)
    .set({
      status: "enqueued",
      pipelineRunId: input.pipelineRunId,
      updatedAt: new Date(),
    })
    .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.status, "pending")))
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

