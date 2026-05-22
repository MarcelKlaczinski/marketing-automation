// Spec 64.9 — HTTP smoke test for POST /api/projects/:slug/trends/briefs/:id/approve.
// Verifies the route is a thin wrapper over `approveBrief` and maps result kinds
// to the documented status codes after the Spec 64.9 path-aware gate fix.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  clusters,
  contentPillars,
  db,
  eq,
  projects,
  sessions,
  topicBriefs,
  users,
} from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let clusterId: string;
let slug: string;
let sessionToken: string;
let userId: string;
const createdBriefIds: string[] = [];

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `trends-approve-${Date.now()}@test.local`,
      name: "Trends Approve Test",
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

  slug = `trends-approve-${Date.now()}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Trends Approve Test",
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
  for (const id of createdBriefIds) {
    await db.delete(topicBriefs).where(eq(topicBriefs.id, id));
  }
  await db.delete(clusters).where(eq(clusters.projectId, projectId));
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

async function insertPendingBrief(
  overrides: Partial<typeof topicBriefs.$inferInsert> = {},
): Promise<typeof topicBriefs.$inferSelect> {
  const [brief] = await db
    .insert(topicBriefs)
    .values({
      projectId,
      source: "trend_discovery",
      topicTitle: "Test trend",
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

describe("POST /api/projects/:slug/trends/briefs/:id/approve (Spec 64.9)", () => {
  it("create_new + mode=queue returns 200 + plan_pending (Marcel-Bug fix)", async () => {
    const brief = await insertPendingBrief({
      clusterAction: "create_new",
      clusterId: null,
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/trends/briefs/${brief.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ mode: "queue" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; briefId: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("plan_pending");
    expect(body.briefId).toBe(brief.id);

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("plan_pending");
  });

  it("append_to_existing + missing clusterId + mode=queue returns 409", async () => {
    const brief = await insertPendingBrief({
      clusterAction: "append_to_existing",
      clusterId: null,
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/trends/briefs/${brief.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ mode: "queue" }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string; next_action: { url: string } };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("cluster_assignment_required");
    expect(body.next_action.url).toContain(`fromBrief=${brief.id}`);

    const [reloaded] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, brief.id))
      .limit(1);
    expect(reloaded?.approvalStatus).toBe("pending");
  });

  it("create_new + mode=generate returns 409 (immediate still requires a cluster)", async () => {
    const brief = await insertPendingBrief({
      clusterAction: "create_new",
      clusterId: null,
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/trends/briefs/${brief.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ mode: "generate" }),
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("cluster_assignment_required");
  });
});
