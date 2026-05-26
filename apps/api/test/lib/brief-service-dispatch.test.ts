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

  // Spec 64.9: gate is path-aware. Plan-dispatch lets create_new through (Planner
  // routes via cluster:full-plan); immediate-dispatch still requires a clusterId.
  it("create_new + plan-dispatch flips to plan_pending (Spec 64.9: Planner regelt es)", async () => {
    const brief = await insertPendingBrief({
      clusterId: null,
      clusterAction: "create_new",
    });

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "plan_queued" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending");
  });

  it("create_new + immediate-dispatch still requires a cluster (regression)", async () => {
    const brief = await insertPendingBrief({
      clusterId: null,
      clusterAction: "create_new",
    });

    const result = await approveBrief(brief.id, { id: projectId }, "immediate");
    expect(result).toEqual({ kind: "cluster_assignment_required" });

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

  // 63.6-followup: comparison-discovery briefs are standalone (clusterId: null,
  // clusterAction: "comparison"). Plan-dispatch must let them through; immediate
  // still requires a cluster (executeDecision INSERTs the article row).
  it("dispatch='plan' on comparison_discovery brief without cluster flips to plan_pending", async () => {
    const brief = await insertPendingBrief({
      source: "comparison_discovery",
      clusterAction: "comparison",
      clusterId: null,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "plan");

    expect(result).toEqual({ kind: "plan_queued" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending");
  });

  it("dispatch='immediate' on comparison_discovery brief without cluster still fails", async () => {
    const brief = await insertPendingBrief({
      source: "comparison_discovery",
      clusterAction: "comparison",
      clusterId: null,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "immediate");

    expect(result).toEqual({ kind: "cluster_assignment_required" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("pending");
  });

  // Spec 64.9: append_to_existing WITHOUT clusterId is the only true editorial gap.
  it("dispatch='plan' on append_to_existing without cluster fails (true editorial gap)", async () => {
    const brief = await insertPendingBrief({
      source: "gap_analysis",
      clusterAction: "append_to_existing",
      clusterId: null,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "cluster_assignment_required" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("pending");
  });

  it("dispatch='plan' on append_to_existing WITH valid clusterId flips to plan_pending", async () => {
    const brief = await insertPendingBrief({
      source: "gap_analysis",
      clusterAction: "append_to_existing",
      clusterId,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "plan_queued" });
  });

  it("dispatch='plan' on trend_discovery create_new flips to plan_pending (Spec 64.9 Marcel-Bug)", async () => {
    const brief = await insertPendingBrief({
      source: "trend_discovery",
      clusterAction: "create_new",
      clusterId: null,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "plan_queued" });
  });

  // ─── Spec 65.10 — recurring-content briefs ────────────────────────────────
  // Recurring briefs land directly as plan_pending with clusterAction='standalone'
  // and clusterId=null. The legacy cluster-gate would 409 every approval — the
  // recurring path bypasses it.

  async function insertRecurringBrief(): Promise<typeof topicBriefs.$inferSelect> {
    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId,
        source: "recurring",
        topicTitle: "5 KI-Tools für Marketing 2026",
        primaryKeyword: "ki marketing tools",
        secondaryKeywords: [],
        clusterAction: "standalone",
        locale: "de",
        approvalStatus: "plan_pending",
        recurringMetadata: {
          definitionId: "11111111-1111-1111-1111-111111111111",
          runNumber: 1,
          previousToolIds: [],
          formatType: "top-n-comparison",
          formatConfig: {
            outputTargets: { social: true },
            selectedTemplateKey: "comparison-grid-3",
            selectedTemplateVia: "lru" as const,
            toolIds: [],
          },
        },
      })
      .returning();
    createdBriefIds.push(brief!.id);
    return brief!;
  }

  it("Spec 65.10: dispatch='plan' on recurring brief returns plan_queued (already plan_pending)", async () => {
    const brief = await insertRecurringBrief();

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "plan_queued" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending");
    // No article should have been created on plan-dispatch.
    expect(reloaded?.routedArticleId).toBeNull();
  });

  it("Spec 65.10: recurring brief cross-project guard returns skipped", async () => {
    const brief = await insertRecurringBrief();

    const result = await approveBrief(
      brief.id,
      { id: "00000000-0000-0000-0000-000000000000" },
      "plan",
    );
    expect(result).toEqual({ kind: "skipped", reason: "not_found_or_not_pending" });

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending"); // unchanged
  });

  it("Spec 65.10: recurring brief does NOT inherit the cluster-assignment-required gate", async () => {
    // Without the Spec 65.10 gate-bypass, this brief (clusterAction='standalone',
    // clusterId=null) would have returned 'cluster_assignment_required' under
    // the legacy non-recurring path. Verify the recurring path lets it through.
    const brief = await insertRecurringBrief();

    const result = await approveBrief(brief.id, { id: projectId }, "plan");
    expect(result).toEqual({ kind: "plan_queued" });
    expect((result as { kind: string }).kind).not.toBe("cluster_assignment_required");
  });

  // Note: dispatch='immediate' on recurring is NOT tested here because it
  // calls `triggerWithPreRunId` → DB INSERT into `pipeline_runs` + BullMQ
  // enqueue (same exclusion as Spec 63.6 dispatch='immediate' tests, see
  // the file-header comment lines 6-10). The brief→article INSERT side is
  // covered by `create-article.test.ts`.

  it("dispatch='immediate' on append_to_existing without cluster fails", async () => {
    const brief = await insertPendingBrief({
      source: "gap_analysis",
      clusterAction: "append_to_existing",
      clusterId: null,
    });

    const result = await approveBrief(brief.id, { id: projectId }, "immediate");
    expect(result).toEqual({ kind: "cluster_assignment_required" });
  });
});
