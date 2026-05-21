/**
 * Spec 63.6 — status-publisher's plan_pending → routed brief flip.
 *
 * Verifies the 2-stage transition described in the spec §3.1:
 *   - markBriefsPlanPending happens at brief-service approve time (tested
 *     in apps/api/test/lib/brief-service-dispatch.test.ts)
 *   - plan_pending → routed happens HERE: when `transitionItemInProgress`
 *     fires (the canonical site called from both execute-plan.ts and the
 *     shared queue worker engine/queue.ts), the source brief is also flipped
 *     to 'routed' in a CAS-guarded UPDATE.
 *
 * Run: bun --filter @marketing-auto/pipelines test
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  plannedItems,
  projects,
  topicBriefs,
  weeklyPlans,
} from "@marketing-auto/db";
import { transitionItemInProgress } from "../../src/execution/status-publisher.ts";

let projectId: string;
let planId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `status-pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "status-pub-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

async function freshPlan(pid: string): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(weeklyPlans)
    .values({
      projectId: pid,
      year: now.getUTCFullYear(),
      // CHECK constraint requires 1..53. Pick a value unlikely to collide with
      // the partial unique index by using year + 53.
      isoWeek: 53,
      weekStartDate: now,
      weekEndDate: now,
      status: "running",
      estimatedCostEur: "0",
      // Strict $type<WeeklyPlanInputSnapshot> on the column — the publisher
      // never reads from inputSnapshot, so an empty cast is safe here (same
      // pattern as packages/db/test/planned-items-execution.test.ts).
      inputSnapshot: {} as never,
    })
    .returning();
  return row!.id;
}

async function freshBrief(pid: string, status: "pending" | "plan_pending" | "routed") {
  const [row] = await db
    .insert(topicBriefs)
    .values({
      projectId: pid,
      source: "gap_analysis",
      topicTitle: "test brief",
      clusterAction: "create_new",
      secondaryKeywords: [],
      approvalStatus: status,
    })
    .returning();
  return row!;
}

async function seedPlannedItem(
  pid: string,
  planIdLocal: string,
  briefId: string | null,
): Promise<string> {
  const today = new Date();
  const [row] = await db
    .insert(plannedItems)
    .values({
      weeklyPlanId: planIdLocal,
      projectId: pid,
      contentType: "blog",
      pipelineName: "article:blog",
      slotDate: today,
      locale: "de",
      sourceKind: "floor",
      sourceBriefId: briefId,
      pipelineInput: {},
      estimatedCostEur: "0",
      status: "enqueued",
    })
    .returning({ id: plannedItems.id });
  return row!.id;
}

beforeEach(async () => {
  projectId = await freshProject();
  planId = await freshPlan(projectId);
});

afterEach(async () => {
  // FK cascades: deleting the project removes weekly_plans, planned_items, topic_briefs.
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("transitionItemInProgress + brief plan_pending → routed flip (Spec 63.6)", () => {
  it("flips a plan_pending brief to routed and stamps routedViaPlanItemId", async () => {
    const brief = await freshBrief(projectId, "plan_pending");
    const itemId = await seedPlannedItem(projectId, planId, brief.id);

    const ok = await transitionItemInProgress({ projectId, planId, itemId });
    expect(ok).toBe(true);

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("routed");
    expect(reloaded?.routedViaPlanItemId).toBe(itemId);
  });

  it("CAS-guard: a brief in 'pending' (not plan_pending) is NOT flipped", async () => {
    const brief = await freshBrief(projectId, "pending");
    const itemId = await seedPlannedItem(projectId, planId, brief.id);

    await transitionItemInProgress({ projectId, planId, itemId });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    // Stays 'pending' — the CAS WHERE clause requires plan_pending
    expect(reloaded?.approvalStatus).toBe("pending");
    expect(reloaded?.routedViaPlanItemId).toBeNull();
  });

  it("planned_item without a source brief is a no-op on the brief side", async () => {
    const itemId = await seedPlannedItem(projectId, planId, null);

    const ok = await transitionItemInProgress({ projectId, planId, itemId });
    expect(ok).toBe(true);
    // No brief was associated — nothing to assert beyond the item flip succeeding.
  });

  it("re-entrancy: a second call when item is already in_progress is a no-op (CAS)", async () => {
    const brief = await freshBrief(projectId, "plan_pending");
    const itemId = await seedPlannedItem(projectId, planId, brief.id);
    await transitionItemInProgress({ projectId, planId, itemId });

    const secondOk = await transitionItemInProgress({ projectId, planId, itemId });
    expect(secondOk).toBe(false); // markPlannedItemInProgress CAS rejects (status is no longer 'enqueued')

    // Brief stays 'routed' from the first call.
    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("routed");
  });
});

