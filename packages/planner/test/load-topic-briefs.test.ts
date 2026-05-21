// Spec 62.4 + 63.6: loadPendingTopicBriefs invariants.
//
// 1. FIFO ordering by created_at ASC within each status bucket (drives the
//    planner's per-goal queue drain — spec §4.2.5).
// 2. Filters to approvalStatus IN ('pending', 'plan_pending'); plan_pending
//    (Marcel approved through BriefsPage with dispatch='plan') sorts BEFORE
//    bare pending so Marcel-vouched briefs are picked first (Spec 63.6).
// 3. Filters to the 5 known source enum values listed in
//    PLANNER_HANDLED_SOURCES — protects against new source types being
//    silently picked up before planner code knows how to route them.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, eq, projects, topicBriefs } from "@marketing-auto/db";
import { loadPendingTopicBriefs, PLANNER_HANDLED_SOURCES } from "../src/index.ts";

let projectId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `load-briefs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "load-briefs-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

beforeEach(async () => {
  projectId = await freshProject();
});

afterEach(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("loadPendingTopicBriefs", () => {
  it("returns rows in created_at ASC (FIFO)", async () => {
    // Insert three briefs with explicit, ascending createdAt timestamps.
    const t0 = new Date(Date.now() - 3 * 60_000);
    const t1 = new Date(Date.now() - 2 * 60_000);
    const t2 = new Date(Date.now() - 1 * 60_000);
    await db.insert(topicBriefs).values([
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "third",
        clusterAction: "create_new",
        secondaryKeywords: [],
        createdAt: t2,
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "first",
        clusterAction: "create_new",
        secondaryKeywords: [],
        createdAt: t0,
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "second",
        clusterAction: "create_new",
        secondaryKeywords: [],
        createdAt: t1,
      },
    ]);

    const rows = await loadPendingTopicBriefs({ projectId });
    expect(rows.map((r) => r.topicTitle)).toEqual(["first", "second", "third"]);
  });

  it("excludes briefs whose approval_status is terminal — keeps pending + plan_pending", async () => {
    const t0 = new Date(Date.now() - 5 * 60_000);
    const t1 = new Date(Date.now() - 4 * 60_000);
    await db.insert(topicBriefs).values([
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "pending-one",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "pending",
        createdAt: t0,
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "plan-pending-one",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "plan_pending",
        createdAt: t1,
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "already-approved",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "approved",
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "routed-out",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "routed",
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "superseded",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "superseded",
      },
    ]);

    const rows = await loadPendingTopicBriefs({ projectId });
    expect(rows.map((r) => r.topicTitle).sort()).toEqual(["pending-one", "plan-pending-one"]);
  });

  it("Spec 63.6: plan_pending briefs sort BEFORE pending briefs (Marcel-vouched first)", async () => {
    // Insert a bare 'pending' brief created BEFORE the plan_pending one — without
    // the status-priority CASE the older pending would come first by FIFO.
    const tOlder = new Date(Date.now() - 10 * 60_000);
    const tNewer = new Date(Date.now() - 1 * 60_000);
    await db.insert(topicBriefs).values([
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "pending-old",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "pending",
        createdAt: tOlder,
      },
      {
        projectId,
        source: "gap_analysis",
        topicTitle: "plan-pending-new",
        clusterAction: "create_new",
        secondaryKeywords: [],
        approvalStatus: "plan_pending",
        createdAt: tNewer,
      },
    ]);

    const rows = await loadPendingTopicBriefs({ projectId });
    expect(rows.map((r) => r.topicTitle)).toEqual(["plan-pending-new", "pending-old"]);
  });

  it("returns rows from all 5 handled sources", async () => {
    await db.insert(topicBriefs).values(
      PLANNER_HANDLED_SOURCES.map((src, i) => ({
        projectId,
        source: src,
        topicTitle: `from-${src}`,
        clusterAction:
          src === "comparison_discovery" ? ("comparison" as const) : ("create_new" as const),
        secondaryKeywords: [],
        createdAt: new Date(Date.now() - (PLANNER_HANDLED_SOURCES.length - i) * 60_000),
      })),
    );

    const rows = await loadPendingTopicBriefs({ projectId });
    expect(rows.map((r) => r.source).sort()).toEqual([...PLANNER_HANDLED_SOURCES].sort());
  });

  it("respects the `limit` parameter", async () => {
    await db.insert(topicBriefs).values(
      Array.from({ length: 10 }, (_, i) => ({
        projectId,
        source: "gap_analysis" as const,
        topicTitle: `b${i}`,
        clusterAction: "create_new" as const,
        secondaryKeywords: [],
        createdAt: new Date(Date.now() - (10 - i) * 60_000),
      })),
    );

    const rows = await loadPendingTopicBriefs({ projectId, limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it("does not leak briefs from other projects", async () => {
    const otherProjectId = await freshProject();
    try {
      await db.insert(topicBriefs).values([
        {
          projectId,
          source: "gap_analysis",
          topicTitle: "mine",
          clusterAction: "create_new",
          secondaryKeywords: [],
        },
        {
          projectId: otherProjectId,
          source: "gap_analysis",
          topicTitle: "not-mine",
          clusterAction: "create_new",
          secondaryKeywords: [],
        },
      ]);

      const rows = await loadPendingTopicBriefs({ projectId });
      expect(rows.map((r) => r.topicTitle)).toEqual(["mine"]);
    } finally {
      await db.delete(topicBriefs).where(eq(topicBriefs.projectId, otherProjectId));
      await db.delete(projects).where(eq(projects.id, otherProjectId));
    }
  });
});
