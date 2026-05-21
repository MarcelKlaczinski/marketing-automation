// Spec 62.4: write helpers for weekly_plans + planned_items.
//
// `persistWeeklyPlan` is the canonical insertion path used by PersistPlanStep:
// optionally supersedes the prior active row, INSERTs the new plan, INSERTs
// all planned_items, and returns the new plan + items — all inside one
// transaction so a mid-write failure rolls everything back. Mirrors the
// "PUT replace = full state must be transactional" rule from
// `replaceProjectGoals` in `project-goal-write.ts`.

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
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
    // Allow cancel from any non-terminal state: a `running` plan can be
    // cancelled by the user mid-execution (in-flight items keep running per
    // 62.8 §5.5; pending+enqueued get cleaned up below).
    if (
      input.toStatus === "cancelled" &&
      current.status !== "draft" &&
      current.status !== "approved" &&
      current.status !== "running"
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

    // When the plan is cancelled, sweep pending+enqueued items to 'cancelled'
    // in the same transaction. In-progress items keep running — BullMQ can't
    // reliably stop a job mid-flight. Without this sweep, cancelled plans
    // leave behind dangling pending items that show up as "Datenmüll" in any
    // future audit query and could confuse the user about plan state.
    if (input.toStatus === "cancelled" && updated) {
      await tx
        .update(plannedItems)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(plannedItems.weeklyPlanId, input.planId),
            inArray(plannedItems.status, ["pending", "enqueued"]),
          ),
        );
    }

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
 * 62.5: Reschedule a pending planned_item to a new slot_date inside its plan
 * week. All four guards run inside one transaction so the constraint set is
 * checked against a consistent snapshot:
 *   - item must exist + belong to `planId`
 *   - item.status must be 'pending'
 *   - plan.status must be in {'draft', 'approved'}
 *   - newSlotDate must satisfy weekStartDate ≤ newSlotDate ≤ weekEndDate
 *
 * Returns a discriminated result so the route handler can pick the right HTTP
 * status: success → 200, ineligible-state → 409, out-of-range → 422.
 */
export type ReschedulePlannedItemResult =
  | { ok: true; item: PlannedItem }
  | { ok: false; reason: "not_found" | "wrong_item_status" | "wrong_plan_status" | "out_of_range" };

export async function reschedulePlannedItem(input: {
  planId: string;
  itemId: string;
  /** UTC date — interpreted as the local plan-day. */
  newSlotDate: Date;
}): Promise<ReschedulePlannedItemResult> {
  return db.transaction(async (tx): Promise<ReschedulePlannedItemResult> => {
    const [item] = await tx
      .select()
      .from(plannedItems)
      .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.weeklyPlanId, input.planId)))
      .limit(1);
    if (!item) return { ok: false, reason: "not_found" };
    if (item.status !== "pending") return { ok: false, reason: "wrong_item_status" };

    const [plan] = await tx
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, input.planId))
      .limit(1);
    if (!plan) return { ok: false, reason: "not_found" };
    if (plan.status !== "draft" && plan.status !== "approved") {
      return { ok: false, reason: "wrong_plan_status" };
    }

    // Compare on date strings (YYYY-MM-DD) to avoid TZ drift — both columns are
    // `date` (not `timestamp`) so Drizzle returns Date objects normalized to
    // UTC midnight.
    const newIso = toIsoDate(input.newSlotDate);
    const startIso = toIsoDate(plan.weekStartDate);
    const endIso = toIsoDate(plan.weekEndDate);
    if (newIso < startIso || newIso > endIso) {
      return { ok: false, reason: "out_of_range" };
    }

    const [updated] = await tx
      .update(plannedItems)
      .set({ slotDate: input.newSlotDate, updatedAt: new Date() })
      .where(eq(plannedItems.id, input.itemId))
      .returning();
    if (!updated) return { ok: false, reason: "not_found" };
    return { ok: true, item: updated };
  });
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── 62.8 execution lifecycle ─────────────────────────────────────────────────
// pending → enqueued → in_progress → completed | failed | skipped(budget) | cancelled
//                                              ↘ retry: failed → pending
// All transitions are CAS-style — the WHERE clause specifies the expected prior
// status, so a stale or racing call is silently a no-op. Returns `true` when the
// row was updated, `false` when no row matched the (id, prior-status) tuple.

/**
 * pending → enqueued. Called by `executePlan()` after the per-item BullMQ
 * `enqueue()` succeeds. Records the pipelineRunId we pre-created via
 * `triggerWithPreRunId` so the UI can deep-link to the run immediately.
 * Sets `enqueuedAt`, increments `attempts`.
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
      enqueuedAt: new Date(),
      attempts: sql`${plannedItems.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.status, "pending")))
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

/**
 * enqueued → in_progress. Called by the shared pipeline-worker layer when a
 * pipeline run actually starts (just before `runPipeline()`). Sets
 * `generationStartedAt`. Idempotent: a re-entrancy (BullMQ retry) on a row
 * already in_progress is a no-op.
 */
export async function markPlannedItemInProgress(input: {
  itemId: string;
}): Promise<boolean> {
  const result = await db
    .update(plannedItems)
    .set({
      status: "in_progress",
      generationStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.status, "enqueued")))
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

/**
 * in_progress → completed. Called from the shared pipeline-worker layer when
 * the content pipeline succeeds (or, per spec choice, from each pipeline's
 * `afterComplete`). Sets `generationCompletedAt`.
 */
export async function markPlannedItemCompleted(input: {
  itemId: string;
  actualCostEur?: string;
}): Promise<boolean> {
  const patch: Partial<NewPlannedItem> = {
    status: "completed",
    generationCompletedAt: new Date(),
    updatedAt: new Date(),
  };
  if (input.actualCostEur !== undefined) patch.actualCostEur = input.actualCostEur;
  const result = await db
    .update(plannedItems)
    .set(patch)
    .where(
      and(
        eq(plannedItems.id, input.itemId),
        inArray(plannedItems.status, ["in_progress", "enqueued"]),
      ),
    )
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

/**
 * (pending | enqueued | in_progress) → failed. Called from the shared
 * pipeline-worker layer when the content pipeline throws or returns ok=false
 * (and is not a batch/step-pause suspension). Also called by `executePlan`
 * when the router throws (e.g. unknown content_type or missing briefId) —
 * the item is still 'pending' at that point, so the WHERE clause includes it.
 * Sets `generationCompletedAt` + `failureReason`.
 */
export async function markPlannedItemFailed(input: {
  itemId: string;
  reason: string;
}): Promise<boolean> {
  const result = await db
    .update(plannedItems)
    .set({
      status: "failed",
      failureReason: input.reason,
      generationCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(plannedItems.id, input.itemId),
        inArray(plannedItems.status, ["pending", "enqueued", "in_progress"]),
      ),
    )
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

/**
 * pending → skipped. Used by the budget-gate path in `executePlan()` when the
 * 90%-of-weekly-budget threshold would be crossed by enqueuing this item.
 * Records the reason so the UI can show "skipped (budget gate)" with tooltip.
 */
export async function markPlannedItemBlocked(input: {
  itemId: string;
  reason: string;
}): Promise<boolean> {
  const result = await db
    .update(plannedItems)
    .set({
      status: "skipped",
      blockReason: input.reason,
      updatedAt: new Date(),
    })
    .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.status, "pending")))
    .returning({ id: plannedItems.id });
  return result.length > 0;
}

/**
 * failed → pending. Manual retry endpoint (POST /planned-items/:id/retry).
 * Clears failure metadata so the next pass starts clean; preserves `attempts`
 * (it'll bump on the next enqueue) and the prior pipelineRunId for audit.
 * Returns the updated row or null if the item wasn't in 'failed' state.
 */
export async function markPlannedItemForRetry(input: {
  itemId: string;
}): Promise<PlannedItem | null> {
  const [updated] = await db
    .update(plannedItems)
    .set({
      status: "pending",
      failureReason: null,
      generationStartedAt: null,
      generationCompletedAt: null,
      // Keep `attempts` and `pipelineRunId` for history visibility.
      updatedAt: new Date(),
    })
    .where(and(eq(plannedItems.id, input.itemId), eq(plannedItems.status, "failed")))
    .returning();
  return updated ?? null;
}

/**
 * Bulk-cancel all pending + enqueued items for a plan. Spec 62.8 §5.5
 * "Cancel All Pending" UI action. Items in 'in_progress' are left alone —
 * BullMQ can't reliably stop a job mid-flight. Returns counts so the route
 * can render the dialog with accurate before/after numbers.
 */
export async function cancelPendingItemsForPlan(planId: string): Promise<{
  cancelled: number;
  generatingUntouched: number;
}> {
  return db.transaction(async (tx) => {
    const generating = await tx
      .select({ id: plannedItems.id })
      .from(plannedItems)
      .where(
        and(
          eq(plannedItems.weeklyPlanId, planId),
          eq(plannedItems.status, "in_progress"),
        ),
      );

    const cancelledRows = await tx
      .update(plannedItems)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(plannedItems.weeklyPlanId, planId),
          inArray(plannedItems.status, ["pending", "enqueued"]),
        ),
      )
      .returning({ id: plannedItems.id });

    return {
      cancelled: cancelledRows.length,
      generatingUntouched: generating.length,
    };
  });
}

// ─── 62.8 plan-status aggregation ─────────────────────────────────────────────

export interface PlanItemCounts {
  total: number;
  pending: number;
  enqueued: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  published: number;
}

/**
 * Aggregate the item-status counts for one plan. Used by the plan-status
 * aggregation hook AND by the frontend progress header.
 */
export async function getPlanItemCounts(planId: string): Promise<PlanItemCounts> {
  const rows = await db
    .select({
      status: plannedItems.status,
      count: sql<number>`count(*)::int`,
    })
    .from(plannedItems)
    .where(eq(plannedItems.weeklyPlanId, planId))
    .groupBy(plannedItems.status);

  const counts: PlanItemCounts = {
    total: 0,
    pending: 0,
    enqueued: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    published: 0,
  };
  for (const r of rows) {
    counts.total += r.count;
    switch (r.status) {
      case "pending":     counts.pending = r.count; break;
      case "enqueued":    counts.enqueued = r.count; break;
      case "in_progress": counts.inProgress = r.count; break;
      case "completed":   counts.completed = r.count; break;
      case "failed":      counts.failed = r.count; break;
      case "skipped":     counts.skipped = r.count; break;
      case "cancelled":   counts.cancelled = r.count; break;
      case "published":   counts.published = r.count; break;
    }
  }
  return counts;
}

/**
 * Flip `weekly_plans.status` to `completed` (no failures) or `partially_failed`
 * (≥1 failed item) when all items are in a terminal state. No-op when items
 * are still pending/enqueued/in_progress. Returns the updated row when the
 * plan transitions, else null. Idempotent — call from every item-status-flip
 * site without guarding.
 *
 * Terminal states for this purpose:
 *   - completed, failed, skipped, cancelled, published
 * Non-terminal:
 *   - pending, enqueued, in_progress
 *
 * Spec note: existing `weekly_plans` CHECK already accepts both 'completed' and
 * 'partially_failed' (migration 0074), so 62.8 needs no enum widening migration.
 */
export async function maybeFinalizePlanStatus(
  planId: string,
): Promise<WeeklyPlan | null> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, planId))
      .limit(1);
    if (!plan) return null;
    // Only roll forward from 'approved' or 'running'. A plan still in 'draft'
    // can't have items in flight (Phase 0 invariant). 'completed' /
    // 'partially_failed' / 'cancelled' / 'superseded' are already terminal.
    if (plan.status !== "approved" && plan.status !== "running") return null;

    const rows = await tx
      .select({
        status: plannedItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(plannedItems)
      .where(eq(plannedItems.weeklyPlanId, planId))
      .groupBy(plannedItems.status);

    let nonTerminal = 0;
    let failed = 0;
    let hadAnyItem = false;
    for (const r of rows) {
      hadAnyItem = true;
      if (r.status === "pending" || r.status === "enqueued" || r.status === "in_progress") {
        nonTerminal += r.count;
      }
      if (r.status === "failed") {
        failed += r.count;
      }
    }
    if (!hadAnyItem) return null;
    if (nonTerminal > 0) return null;

    const nextStatus: WeeklyPlan["status"] =
      failed > 0 ? "partially_failed" : "completed";
    const [updated] = await tx
      .update(weeklyPlans)
      .set({
        status: nextStatus,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(weeklyPlans.id, planId))
      .returning();
    return updated ?? null;
  });
}

// ─── 62.8 read helper for the executor ────────────────────────────────────────

/**
 * Load all pending items for one plan in the order the executor should
 * enqueue them: by slot_date asc, then by created_at asc as a stable
 * tiebreaker. Matches the partial unique index `planned_items_by_plan_pending_idx`.
 */
export async function loadPendingItemsForPlan(planId: string): Promise<PlannedItem[]> {
  return db
    .select()
    .from(plannedItems)
    .where(
      and(eq(plannedItems.weeklyPlanId, planId), eq(plannedItems.status, "pending")),
    )
    .orderBy(plannedItems.slotDate, plannedItems.createdAt);
}

