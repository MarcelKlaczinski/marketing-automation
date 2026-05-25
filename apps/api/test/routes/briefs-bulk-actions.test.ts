/**
 * Spec 64.17 — Bulk brief actions HTTP tests.
 *
 * Covers:
 *  - bulk-approve briefIds-shape (plan dispatch only — immediate triggers
 *    real triggerWithPreRunId + BullMQ enqueue which is out of scope for unit
 *    tests, mirrors the convention in brief-service-dispatch.test.ts)
 *  - bulk-approve filter-shape (race-condition surface via reQueried=true)
 *  - bulk-approve cluster-assignment-required surface in skipped count
 *  - bulk-approve cap-overshoot rejection
 *  - bulk-dismiss filter-shape with plan_pending constraint preservation
 *  - bulk-preflight-cluster-check SQL aggregate (plan vs immediate eligibility)
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  clusters,
  contentPillars,
  db,
  eq,
  inArray,
  projects,
  sessions,
  topicBriefs,
  users,
} from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let slug: string;
let sessionToken: string;
let userId: string;
let clusterId: string;
const createdBriefIds: string[] = [];

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `briefs-bulk-${Date.now()}@test.local`,
      name: "Briefs Bulk Test",
      role: "owner",
    })
    .returning({ id: users.id });
  userId = user!.id;

  sessionToken = `tok-${crypto.randomUUID()}`;
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  slug = `briefs-bulk-${Date.now()}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Briefs Bulk Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

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
    await db.delete(topicBriefs).where(inArray(topicBriefs.id, createdBriefIds));
  }
  await db.delete(clusters).where(eq(clusters.id, clusterId));
  await db.delete(contentPillars).where(eq(contentPillars.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `ma_session=${sessionToken}`,
      ...(init.headers ?? {}),
    },
  });
}

async function insertBrief(overrides: Partial<typeof topicBriefs.$inferInsert> = {}) {
  const [brief] = await db
    .insert(topicBriefs)
    .values({
      projectId,
      source: "gap_analysis",
      topicTitle: "Bulk test brief",
      primaryKeyword: "bulk test",
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

describe("POST /api/projects/:slug/briefs/bulk-approve (Spec 64.17)", () => {
  // ─── Test #1: briefIds shape, plan dispatch happy path ─────────────────────
  it("briefIds shape: plan dispatch flips N pending → plan_pending", async () => {
    const b1 = await insertBrief({ topicTitle: "Test #1a" });
    const b2 = await insertBrief({ topicTitle: "Test #1b" });
    const b3 = await insertBrief({ topicTitle: "Test #1c" });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-approve`, {
        method: "POST",
        body: JSON.stringify({ briefIds: [b1.id, b2.id, b3.id], dispatch: "plan" }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        dispatch: string;
        reQueried: boolean;
        totalMatched: number;
        approvedCount: number;
        planQueuedCount: number;
        skippedCount: number;
        failedCount: number;
      };
    };
    expect(body.data.dispatch).toBe("plan");
    expect(body.data.reQueried).toBe(false);
    expect(body.data.totalMatched).toBe(3);
    expect(body.data.planQueuedCount).toBe(3);
    expect(body.data.skippedCount).toBe(0);
    expect(body.data.failedCount).toBe(0);
  });

  // ─── Test #2: filter shape with excludeIds ─────────────────────────────────
  it("filter shape: section=pending + excludeIds[2] → processes 3 of 5", async () => {
    const b1 = await insertBrief({ topicTitle: "Filter #2a" });
    await insertBrief({ topicTitle: "Filter #2b" });
    const b3 = await insertBrief({ topicTitle: "Filter #2c" });
    await insertBrief({ topicTitle: "Filter #2d" });
    await insertBrief({ topicTitle: "Filter #2e" });
    // Use only briefs from THIS test as exclusion targets to keep the assertion
    // robust against any pending briefs left by prior `it` blocks.

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-approve`, {
        method: "POST",
        body: JSON.stringify({
          filter: { section: "pending" },
          excludeIds: [b1.id, b3.id],
          dispatch: "plan",
        }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      data: { reQueried: boolean; planQueuedCount: number; totalMatched: number };
    };
    expect(body.data.reQueried).toBe(true);
    // 3 fresh briefs (b2, b4, b5) — plus we tolerate stragglers from #1 which
    // remain pending after plan flip → plan_pending; the filter section=pending
    // matches plan_pending too (Spec 63.6).
    expect(body.data.planQueuedCount).toBeGreaterThanOrEqual(3);
    expect(body.data.totalMatched).toBeGreaterThanOrEqual(3);

    // Verify the 2 excluded briefs are still pending (NOT plan_pending)
    const [s1] = await db
      .select({ status: topicBriefs.approvalStatus })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, b1.id));
    const [s3] = await db
      .select({ status: topicBriefs.approvalStatus })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, b3.id));
    expect(s1?.status).toBe("pending");
    expect(s3?.status).toBe("pending");
  });

  // ─── Test #3: cluster_assignment_required surfaces in skipped count ────────
  it("plan dispatch: append_to_existing without clusterId → skipped (cluster_assignment_required)", async () => {
    const b1 = await insertBrief({
      topicTitle: "No-cluster brief #3",
      clusterAction: "append_to_existing",
      clusterId: null,
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-approve`, {
        method: "POST",
        body: JSON.stringify({ briefIds: [b1.id], dispatch: "plan" }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        skippedCount: number;
        planQueuedCount: number;
        results: { skipped: Array<{ briefId: string; reason: string }> };
      };
    };
    expect(body.data.planQueuedCount).toBe(0);
    expect(body.data.skippedCount).toBe(1);
    expect(body.data.results.skipped[0]?.reason).toBe("cluster_assignment_required");
  });

  // ─── Test #4: cap overshoot ─────────────────────────────────────────────────
  it("briefIds.length > 500 → 400 Zod reject", async () => {
    const ids = Array.from({ length: 501 }, () => crypto.randomUUID());

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-approve`, {
        method: "POST",
        body: JSON.stringify({ briefIds: ids, dispatch: "plan" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  // ─── Test #5: briefIds cap of 500 is accepted (boundary) ───────────────────
  // 15s timeout: boundary test sends 500 unknown UUIDs through sequential
  // `approveBrief()` calls (briefs.ts:227). Each call does a DB SELECT; under
  // full-suite parallel load the per-call latency rises and the 5s Bun default
  // is too tight. Passes well under 2s in isolation — only flakes when run
  // alongside other test files contending for the connection pool.
  it("briefIds.length = 500 of unknown UUIDs → 202 with 0 processed (no-op)", { timeout: 15_000 }, async () => {
    const ids = Array.from({ length: 500 }, () => crypto.randomUUID());

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-approve`, {
        method: "POST",
        body: JSON.stringify({ briefIds: ids, dispatch: "plan" }),
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      data: { planQueuedCount: number; skippedCount: number };
    };
    expect(body.data.planQueuedCount).toBe(0);
    // All 500 are unknown → each returns skipped(not_found_or_not_pending)
    expect(body.data.skippedCount).toBe(500);
  });
});

describe("POST /api/projects/:slug/briefs/bulk-dismiss (Spec 64.17)", () => {
  // ─── Test #6: filter shape with readiness=plan_ready → 0 dismissed ────────
  it("filter readiness=plan_ready: plan_pending briefs are protected from dismiss", async () => {
    const planPending = await insertBrief({
      topicTitle: "Plan-vouched brief #6",
      approvalStatus: "plan_pending",
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-dismiss`, {
        method: "POST",
        body: JSON.stringify({
          filter: { section: "pending", readiness: "plan_ready" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { reQueried: boolean; totalMatched: number; dismissed: number; skipped: number };
    };
    expect(body.data.reQueried).toBe(true);
    expect(body.data.totalMatched).toBeGreaterThanOrEqual(1);
    expect(body.data.dismissed).toBe(0);
    expect(body.data.skipped).toBeGreaterThanOrEqual(1);

    // Confirm the brief is still plan_pending
    const [row] = await db
      .select({ status: topicBriefs.approvalStatus })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, planPending.id));
    expect(row?.status).toBe("plan_pending");
  });

  it("briefIds shape: dismisses pending briefs to rejected", async () => {
    const b1 = await insertBrief({ topicTitle: "Dismiss-me #6b" });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-dismiss`, {
        method: "POST",
        body: JSON.stringify({ briefIds: [b1.id] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { dismissed: number };
    };
    expect(body.data.dismissed).toBe(1);

    const [row] = await db
      .select({ status: topicBriefs.approvalStatus })
      .from(topicBriefs)
      .where(eq(topicBriefs.id, b1.id));
    expect(row?.status).toBe("rejected");
  });
});

describe("POST /api/projects/:slug/briefs/bulk-preflight-cluster-check (Spec 64.17)", () => {
  // ─── Test #7: mixed cluster_action set → correct plan + immediate counts ──
  it("returns correct eligibility breakdown for plan vs immediate dispatch", async () => {
    // 2 briefs: append_to_existing + no cluster (plan-blocked, immediate-blocked)
    const noCluster1 = await insertBrief({
      topicTitle: "Preflight #7a",
      clusterAction: "append_to_existing",
      clusterId: null,
    });
    const noCluster2 = await insertBrief({
      topicTitle: "Preflight #7b",
      clusterAction: "append_to_existing",
      clusterId: null,
    });
    // 1 brief: create_new (plan-OK, immediate-blocked)
    const createNew = await insertBrief({
      topicTitle: "Preflight #7c",
      clusterAction: "create_new",
      clusterId: null,
    });
    // 2 briefs: append_to_existing + cluster (plan-OK, immediate-OK)
    const ok1 = await insertBrief({ topicTitle: "Preflight #7d" });
    const ok2 = await insertBrief({ topicTitle: "Preflight #7e" });

    const ids = [noCluster1.id, noCluster2.id, createNew.id, ok1.id, ok2.id];

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-preflight-cluster-check`, {
        method: "POST",
        body: JSON.stringify({ briefIds: ids }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        totalMatched: number;
        plan: { eligible: number; needsCluster: number };
        immediate: { eligible: number; needsCluster: number };
      };
    };
    expect(body.data.totalMatched).toBe(5);
    // Plan-dispatch only blocks append_to_existing+null-cluster (2 briefs).
    expect(body.data.plan.needsCluster).toBe(2);
    expect(body.data.plan.eligible).toBe(3);
    // Immediate-dispatch blocks: create_new OR null-cluster (3 briefs).
    expect(body.data.immediate.needsCluster).toBe(3);
    expect(body.data.immediate.eligible).toBe(2);
  });

  // ─── Test #8: empty selection returns zero-aggregate ──────────────────────
  it("empty selection (filter matches nothing) returns all-zero aggregate", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-preflight-cluster-check`, {
        method: "POST",
        body: JSON.stringify({
          filter: { section: "pending", source: ["refresh_detection"] }, // Toolwiki test has none
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { totalMatched: number; plan: { eligible: number }; immediate: { eligible: number } };
    };
    expect(body.data.totalMatched).toBe(0);
    expect(body.data.plan.eligible).toBe(0);
    expect(body.data.immediate.eligible).toBe(0);
  });

  // ─── Test #9: filter shape resolves IDs server-side ────────────────────────
  it("filter shape: resolves IDs server-side + reports reQueried=true", async () => {
    await insertBrief({ topicTitle: "Filter-shape preflight #9a" });
    await insertBrief({ topicTitle: "Filter-shape preflight #9b" });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs/bulk-preflight-cluster-check`, {
        method: "POST",
        body: JSON.stringify({ filter: { section: "pending" } }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { reQueried: boolean; totalMatched: number };
    };
    expect(body.data.reQueried).toBe(true);
    expect(body.data.totalMatched).toBeGreaterThanOrEqual(2);
  });
});
