/**
 * Spec 63.6 — brief-service dispatch branch tests.
 *
 * Exercises `approveBrief(briefId, project, dispatch)` directly at the DB layer:
 *  - dispatch='plan'      → pending → plan_pending (no article, no enqueue)
 *  - dispatch='immediate' is NOT tested here (would call triggerWithPreRunId →
 *    DB INSERTs into pipeline_runs + a real BullMQ enqueue; covered by the
 *    pre-existing approve-and-enqueue smoke test). We only verify the plan
 *    branch is correct and the CAS guards work.
 *  - Idempotency: re-approve plan_pending → 'skipped' (CAS failed).
 *  - Cluster gate: create_new briefs → 'cluster_assignment_required'.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  clusters,
  contentPillars,
  db,
  eq,
  projects,
  topicBriefs,
} from "@marketing-auto/db";

import { approveBrief } from "../../src/lib/brief-service.ts";

describe("brief-service approveBrief dispatch (Spec 63.6)", () => {
  let projectId: string;
  let clusterId: string;
  const createdBriefIds: string[] = [];

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `brief-dispatch-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Brief Dispatch Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({ projectId, name: "AI Tools", position: 0 })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "KI Tools",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-tools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;
  });

  afterAll(async () => {
    if (createdBriefIds.length > 0) {
      for (const id of createdBriefIds) {
        await db.delete(topicBriefs).where(eq(topicBriefs.id, id));
      }
    }
  });

  async function insertPendingBrief(overrides: Partial<typeof topicBriefs.$inferInsert> = {}) {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "gap_analysis",
        topicTitle: "Test topic",
        primaryKeyword: "test keyword",
        secondaryKeywords: [],
        clusterId,
        clusterAction: "append_to_existing",
        locale: "de",
        intentType: "general",
        generationMode: "spoke",
        approvalStatus: "pending",
        ...overrides,
      })
      .returning();
    createdBriefIds.push(brief!.id);
    return brief!;
  }

  it("dispatch='plan' flips pending → plan_pending and inserts no article", async () => {
    const brief = await insertPendingBrief();

    const result = await approveBrief(brief.id, { id: projectId }, "plan");

    expect(result).toEqual({ kind: "plan_queued" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending");
    expect(reloaded?.approvedAt).toBeInstanceOf(Date);
    expect(reloaded?.routedArticleId).toBeNull();
    expect(reloaded?.routedViaPlanItemId).toBeNull();
  });

  it("dispatch='plan' is idempotent — second call returns skipped (CAS guard)", async () => {
    const brief = await insertPendingBrief();
    await approveBrief(brief.id, { id: projectId }, "plan");

    const second = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(second).toEqual({ kind: "skipped", reason: "not_found_or_not_pending" });
  });

  it("rejects create_new briefs as cluster_assignment_required (both modes)", async () => {
    const brief = await insertPendingBrief({
      clusterId: null,
      clusterAction: "create_new",
    });

    const planRes = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(planRes).toEqual({ kind: "cluster_assignment_required" });

    const immediateRes = await approveBrief(brief.id, { id: projectId }, "immediate");
    expect(immediateRes).toEqual({ kind: "cluster_assignment_required" });

    // brief stays pending — neither branch wrote anything
    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("pending");
  });

  it("dispatch='plan' on an already-routed brief returns skipped", async () => {
    const brief = await insertPendingBrief();
    await db
      .update(topicBriefs)
      .set({ approvalStatus: "routed" })
      .where(eq(topicBriefs.id, brief.id));

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "skipped", reason: "not_found_or_not_pending" });
  });

  it("dispatch='plan' on a brief belonging to a different project returns skipped", async () => {
    const brief = await insertPendingBrief();

    const result = await approveBrief(
      brief.id,
      { id: "00000000-0000-0000-0000-000000000000" },
      "plan",
    );
    expect(result).toEqual({ kind: "skipped", reason: "not_found_or_not_pending" });
  });
});
