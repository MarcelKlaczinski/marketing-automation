// Spec 62.5: reschedulePlannedItem helper guards.
//
// Verifies the 4 transactional guards (item exists, item.status=pending,
// plan.status in draft/approved, newSlotDate within week range). The route
// handler dispatches on these reasons → 404/409/422.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  cancelPlannedItem,
  db,
  eq,
  plannedItems,
  projects,
  reschedulePlannedItem,
  topicBriefs,
  transitionWeeklyPlanStatus,
  weeklyPlans,
} from "@marketing-auto/db";

let projectId: string;
let planId: string;
let itemId: string;

const WEEK_START = new Date("2026-05-25T00:00:00.000Z"); // Mo
const WEEK_END = new Date("2026-05-31T00:00:00.000Z"); // So
const DAY_INSIDE_WEEK = new Date("2026-05-27T00:00:00.000Z"); // Mi
const DAY_BEFORE_WEEK = new Date("2026-05-24T00:00:00.000Z");
const DAY_AFTER_WEEK = new Date("2026-06-01T00:00:00.000Z");

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `resched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "resched-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

async function seedPlan(
  overrides: { year?: number; isoWeek?: number; weekStartDate?: Date; weekEndDate?: Date } = {},
): Promise<{ planId: string; itemId: string }> {
  const [plan] = await db
    .insert(weeklyPlans)
    .values({
      projectId,
      year: overrides.year ?? 2026,
      isoWeek: overrides.isoWeek ?? 22,
      weekStartDate: overrides.weekStartDate ?? WEEK_START,
      weekEndDate: overrides.weekEndDate ?? WEEK_END,
      status: "draft",
      estimatedCostEur: "0.50",
      inputSnapshot: {
        goals: [],
        config: {
          weeklyBudgetEur: 50,
          perTypeMaxEur: null,
          topNSignalsAllowedOverage: 3,
          maxOveragePerSignal: 1,
          signalMaxAgeHours: 168,
          excludedPipelines: [],
          llmMode: "sync" as const,
        },
        signalRefreshResult: {
          projectId,
          triggeredAt: new Date().toISOString(),
          sourceResults: [],
          totalRowsAdded: 0,
          durationMs: 0,
        },
        topicBriefSnapshot: [],
        signalTopN: [],
        triggeredAt: new Date().toISOString(),
      },
    })
    .returning();
  const [item] = await db
    .insert(plannedItems)
    .values({
      weeklyPlanId: plan!.id,
      projectId,
      contentType: "cluster",
      pipelineName: "article:blog",
      slotDate: overrides.weekStartDate ?? WEEK_START,
      sourceKind: "floor",
      pipelineInput: {},
      estimatedCostEur: "0.300000",
      status: "pending",
    })
    .returning();
  return { planId: plan!.id, itemId: item!.id };
}

beforeEach(async () => {
  projectId = await freshProject();
  const seeded = await seedPlan();
  planId = seeded.planId;
  itemId = seeded.itemId;
});

afterEach(async () => {
  await db.delete(plannedItems).where(eq(plannedItems.projectId, projectId));
  await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("reschedulePlannedItem", () => {
  it("happy path: pending item, draft plan, in-range date → updates slot_date", async () => {
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.item.slotDate.toISOString().slice(0, 10)).toBe("2026-05-27");
  });

  it("approved plan still allows reschedule of pending items", async () => {
    await transitionWeeklyPlanStatus({ planId, toStatus: "approved", approvedBy: "test" });
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(true);
  });

  it("date BEFORE plan week → out_of_range", async () => {
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_BEFORE_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("out_of_range");
  });

  it("date AFTER plan week → out_of_range", async () => {
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_AFTER_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("out_of_range");
  });

  it("cancelled item → wrong_item_status", async () => {
    await cancelPlannedItem(itemId);
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("wrong_item_status");
  });

  it("cancelled plan → wrong_plan_status", async () => {
    await transitionWeeklyPlanStatus({ planId, toStatus: "cancelled" });
    const result = await reschedulePlannedItem({
      planId,
      itemId,
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("wrong_plan_status");
  });

  it("unknown item id → not_found", async () => {
    const result = await reschedulePlannedItem({
      planId,
      itemId: "00000000-0000-0000-0000-000000000000",
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("not_found");
  });

  it("item belongs to different plan → not_found", async () => {
    // Seed a second plan in a DIFFERENT ISO week so the partial unique index
    // `weekly_plans_one_active_per_week` doesn't trip.
    const otherWeekStart = new Date("2026-06-01T00:00:00.000Z"); // Mo of KW 23
    const otherWeekEnd = new Date("2026-06-07T00:00:00.000Z");
    const otherPlan = await seedPlan({
      isoWeek: 23,
      weekStartDate: otherWeekStart,
      weekEndDate: otherWeekEnd,
    });
    const result = await reschedulePlannedItem({
      planId: otherPlan.planId,
      itemId, // belongs to the FIRST plan
      newSlotDate: DAY_INSIDE_WEEK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("not_found");
  });
});

describe("patchPlannedItemPayloadSchema (exclusive-or)", () => {
  it("rejects both status and slotDate together", async () => {
    const { patchPlannedItemPayloadSchema } = await import("@marketing-auto/shared");
    const r = patchPlannedItemPayloadSchema.safeParse({
      status: "cancelled",
      slotDate: "2026-05-27",
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither (empty body)", async () => {
    const { patchPlannedItemPayloadSchema } = await import("@marketing-auto/shared");
    const r = patchPlannedItemPayloadSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts slotDate alone", async () => {
    const { patchPlannedItemPayloadSchema } = await import("@marketing-auto/shared");
    const r = patchPlannedItemPayloadSchema.safeParse({ slotDate: "2026-05-27" });
    expect(r.success).toBe(true);
  });

  it("rejects malformed slotDate", async () => {
    const { patchPlannedItemPayloadSchema } = await import("@marketing-auto/shared");
    const r = patchPlannedItemPayloadSchema.safeParse({ slotDate: "27.05.2026" });
    expect(r.success).toBe(false);
  });
});
