// Spec 62.8: planned-item execution-status helpers + plan-status aggregation.
// DB-touching unit tests — verifies the CAS WHERE clauses behave correctly
// across the 8-state lifecycle and that maybeFinalizePlanStatus rolls the
// plan to completed/partially_failed only when all items terminate.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  cancelPendingItemsForPlan,
  db,
  getPlanItemCounts,
  loadPendingItemsForPlan,
  markPlannedItemBlocked,
  markPlannedItemCompleted,
  markPlannedItemEnqueued,
  markPlannedItemFailed,
  markPlannedItemForRetry,
  markPlannedItemInProgress,
  maybeFinalizePlanStatus,
  plannedItems,
  projects,
  weeklyPlans,
} from "../src/index.ts";

// packages/db doesn't depend on @marketing-auto/planner, so inline an ISO-week
// helper just for the test fixture. Identical to planner's isoWeekStartDate.
function isoWeekStartDate(year: number, isoWeek: number): Date {
  // Jan 4 is always in ISO week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay() || 7;
  const mondayOfWeek1 = jan4 - (jan4Day - 1) * 86_400_000;
  return new Date(mondayOfWeek1 + (isoWeek - 1) * 7 * 86_400_000);
}

describe("Spec 62.8 — planned_items execution helpers", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `exec-helpers-${ts}`,
        name: "Exec Helpers Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project insert failed");
    projectId = proj.id;
  });

  afterAll(async () => {
    // Cascade deletes weekly_plans + planned_items.
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function createPlanWithItems(itemCount: number): Promise<{
    planId: string;
    itemIds: string[];
  }> {
    const year = 2026;
    const isoWeek = 30;
    const weekStart = isoWeekStartDate(year, isoWeek);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
    const [plan] = await db
      .insert(weeklyPlans)
      .values({
        projectId,
        year,
        isoWeek,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        status: "approved",
        estimatedCostEur: "1.50",
        // weeklyPlans.inputSnapshot has a strict $type<WeeklyPlanInputSnapshot>.
        // Cast for the fixture — the helpers under test only read the JSONB
        // back via `plan.inputSnapshot?.config?.llmMode`, never these fields.
        inputSnapshot: {} as never,
      })
      .returning();
    const itemRows = Array.from({ length: itemCount }, (_, i) => ({
      weeklyPlanId: plan!.id,
      projectId,
      contentType: "comparison" as const,
      pipelineName: "article:blog",
      slotDate: new Date(weekStart.getTime() + i * 86_400_000),
      sourceKind: "floor" as const,
      pipelineInput: { briefId: `brief-${i}` },
      estimatedCostEur: "0.50",
      selectionReason: `test ${i}`,
    }));
    const inserted = await db.insert(plannedItems).values(itemRows).returning({
      id: plannedItems.id,
    });
    return { planId: plan!.id, itemIds: inserted.map((r) => r.id) };
  }

  async function cleanupPlan(planId: string): Promise<void> {
    await db.delete(weeklyPlans).where(eq(weeklyPlans.id, planId));
  }

  it("markPlannedItemEnqueued flips pending → enqueued and increments attempts", async () => {
    const { planId, itemIds } = await createPlanWithItems(1);
    const runId = crypto.randomUUID();
    const ok = await markPlannedItemEnqueued({ itemId: itemIds[0]!, pipelineRunId: runId });
    expect(ok).toBe(true);

    const [row] = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.id, itemIds[0]!));
    expect(row?.status).toBe("enqueued");
    expect(row?.attempts).toBe(1);
    expect(row?.pipelineRunId).toBe(runId);
    expect(row?.enqueuedAt).toBeDefined();
    await cleanupPlan(planId);
  });

  it("markPlannedItemInProgress is a no-op on rows that are not 'enqueued'", async () => {
    const { planId, itemIds } = await createPlanWithItems(1);
    // Item is still 'pending' — the CAS-guard should reject the flip.
    const ok = await markPlannedItemInProgress({ itemId: itemIds[0]! });
    expect(ok).toBe(false);
    await cleanupPlan(planId);
  });

  it("markPlannedItemBlocked records budget_gate reason and flips to skipped", async () => {
    const { planId, itemIds } = await createPlanWithItems(1);
    const ok = await markPlannedItemBlocked({
      itemId: itemIds[0]!,
      reason: "budget_gate",
    });
    expect(ok).toBe(true);
    const [row] = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.id, itemIds[0]!));
    expect(row?.status).toBe("skipped");
    expect(row?.blockReason).toBe("budget_gate");
    await cleanupPlan(planId);
  });

  it("markPlannedItemForRetry only resets rows in 'failed' state", async () => {
    const { planId, itemIds } = await createPlanWithItems(1);
    const runId = crypto.randomUUID();
    await markPlannedItemEnqueued({ itemId: itemIds[0]!, pipelineRunId: runId });
    await markPlannedItemInProgress({ itemId: itemIds[0]! });
    await markPlannedItemFailed({ itemId: itemIds[0]!, reason: "boom" });

    const updated = await markPlannedItemForRetry({ itemId: itemIds[0]! });
    expect(updated?.status).toBe("pending");
    expect(updated?.failureReason).toBeNull();
    // attempts should be preserved
    expect(updated?.attempts).toBe(1);

    // Second retry attempt on a now-pending row must return null
    const second = await markPlannedItemForRetry({ itemId: itemIds[0]! });
    expect(second).toBeNull();
    await cleanupPlan(planId);
  });

  it("maybeFinalizePlanStatus -> 'completed' when all items succeed", async () => {
    const { planId, itemIds } = await createPlanWithItems(2);
    // First item completes — plan still has pending items, so no transition
    await markPlannedItemEnqueued({
      itemId: itemIds[0]!,
      pipelineRunId: crypto.randomUUID(),
    });
    await markPlannedItemInProgress({ itemId: itemIds[0]! });
    await markPlannedItemCompleted({ itemId: itemIds[0]! });
    const stillRunning = await maybeFinalizePlanStatus(planId);
    expect(stillRunning).toBeNull();

    // Second item completes — now plan terminates as 'completed'
    await markPlannedItemEnqueued({
      itemId: itemIds[1]!,
      pipelineRunId: crypto.randomUUID(),
    });
    await markPlannedItemInProgress({ itemId: itemIds[1]! });
    await markPlannedItemCompleted({ itemId: itemIds[1]! });
    const finalized = await maybeFinalizePlanStatus(planId);
    expect(finalized?.status).toBe("completed");
    expect(finalized?.completedAt).toBeDefined();
    await cleanupPlan(planId);
  });

  it("maybeFinalizePlanStatus -> 'partially_failed' when any item failed", async () => {
    const { planId, itemIds } = await createPlanWithItems(2);
    // Item 0: success
    await markPlannedItemEnqueued({
      itemId: itemIds[0]!,
      pipelineRunId: crypto.randomUUID(),
    });
    await markPlannedItemInProgress({ itemId: itemIds[0]! });
    await markPlannedItemCompleted({ itemId: itemIds[0]! });
    // Item 1: failure
    await markPlannedItemEnqueued({
      itemId: itemIds[1]!,
      pipelineRunId: crypto.randomUUID(),
    });
    await markPlannedItemInProgress({ itemId: itemIds[1]! });
    await markPlannedItemFailed({ itemId: itemIds[1]!, reason: "boom" });

    const finalized = await maybeFinalizePlanStatus(planId);
    expect(finalized?.status).toBe("partially_failed");
    await cleanupPlan(planId);
  });

  it("cancelPendingItemsForPlan cancels pending+enqueued, leaves in_progress alone", async () => {
    const { planId, itemIds } = await createPlanWithItems(3);
    // Item 0: stays pending
    // Item 1: enqueued
    await markPlannedItemEnqueued({
      itemId: itemIds[1]!,
      pipelineRunId: crypto.randomUUID(),
    });
    // Item 2: in_progress (mid-flight; cancel-pending must NOT touch it)
    await markPlannedItemEnqueued({
      itemId: itemIds[2]!,
      pipelineRunId: crypto.randomUUID(),
    });
    await markPlannedItemInProgress({ itemId: itemIds[2]! });

    const result = await cancelPendingItemsForPlan(planId);
    expect(result.cancelled).toBe(2);
    expect(result.generatingUntouched).toBe(1);

    const counts = await getPlanItemCounts(planId);
    expect(counts.cancelled).toBe(2);
    expect(counts.inProgress).toBe(1);
    expect(counts.pending).toBe(0);
    expect(counts.enqueued).toBe(0);
    await cleanupPlan(planId);
  });

  it("loadPendingItemsForPlan returns only pending rows in slot-date order", async () => {
    const { planId, itemIds } = await createPlanWithItems(3);
    // Promote itemIds[1] past pending — it should NOT appear in the read.
    await markPlannedItemEnqueued({
      itemId: itemIds[1]!,
      pipelineRunId: crypto.randomUUID(),
    });
    const pending = await loadPendingItemsForPlan(planId);
    expect(pending.length).toBe(2);
    expect(pending.map((p) => p.id).sort()).toEqual([itemIds[0]!, itemIds[2]!].sort());
    await cleanupPlan(planId);
  });
});
