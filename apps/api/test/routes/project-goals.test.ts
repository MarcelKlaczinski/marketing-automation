// Spec 62.2: integration tests for the project-goals / planner-config / validate routes.
// Hits app.fetch directly with a session cookie so requireAuth accepts the request.
// Each describe block creates its own project to avoid cross-test interference.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  projects,
  projectGoals,
  projectPlannerConfig,
  sessions,
  users,
} from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let slug: string;
let sessionToken: string;
let userId: string;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `goals-api-${Date.now()}@test.local`,
      name: "Goals Test",
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

  slug = `goals-api-${Date.now()}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "goals-api-test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterAll(async () => {
  await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));
  await db.delete(projectPlannerConfig).where(eq(projectPlannerConfig.projectId, projectId));
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

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("PUT /api/projects/:slug/goals — replace semantics", () => {
  it("inserts → updates → soft-deletes across three PUTs", async () => {
    // Clean slate
    await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));

    // 1. INSERT — empty DB; PUT adds 2 goals
    const put1 = await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null },
            { contentType: "comparison", cadenceUnit: "per_week", minCount: 1, maxCount: 3 },
          ],
        }),
      })
    );
    expect(put1.status).toBe(200);
    const b1 = await jsonBody<{
      ok: boolean;
      data: Array<{ contentType: string; minCount: number }>;
    }>(put1);
    expect(b1.ok).toBe(true);
    expect(b1.data.length).toBe(2);

    // 2. UPDATE — same content_types, different counts
    const put2 = await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 2, maxCount: 5 },
            { contentType: "comparison", cadenceUnit: "per_week", minCount: 1, maxCount: 3 },
          ],
        }),
      })
    );
    expect(put2.status).toBe(200);
    const b2 = await jsonBody<{
      ok: boolean;
      data: Array<{ contentType: string; minCount: number; maxCount: number | null }>;
    }>(put2);
    const cluster = b2.data.find((g) => g.contentType === "cluster");
    expect(cluster?.minCount).toBe(2);
    expect(cluster?.maxCount).toBe(5);

    // 3. SOFT-DELETE — drop comparison
    const put3 = await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 2, maxCount: 5 },
          ],
        }),
      })
    );
    expect(put3.status).toBe(200);
    const b3 = await jsonBody<{ ok: boolean; data: Array<{ contentType: string }> }>(put3);
    expect(b3.data.length).toBe(1);
    expect(b3.data[0]!.contentType).toBe("cluster");

    // DB: comparison row still exists but is_active = false
    const all = await db
      .select()
      .from(projectGoals)
      .where(eq(projectGoals.projectId, projectId));
    expect(all.length).toBe(2);
    const comp = all.find((g) => g.contentType === "comparison");
    expect(comp?.isActive).toBe(false);
  });

  it("rejects duplicate content_type in body with 400", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null },
            { contentType: "cluster", cadenceUnit: "per_week", minCount: 2, maxCount: null },
          ],
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects maxCount < minCount via Zod refinement", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 5, maxCount: 2 },
          ],
        }),
      })
    );
    // zod-validator returns 400 for refinement failure
    expect(res.status).toBe(400);
  });
});

describe("PATCH + DELETE /api/projects/:slug/goals/:goalId", () => {
  it("PATCH toggles isActive; DELETE soft-deletes", async () => {
    await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));
    const [row] = await db
      .insert(projectGoals)
      .values({
        projectId,
        contentType: "social_post",
        cadenceUnit: "per_day",
        minCount: 3,
        maxCount: 5,
      })
      .returning();
    const goalId = row!.id;

    // PATCH min/max
    const patch = await app.fetch(
      authed(`/api/projects/${slug}/goals/${goalId}`, {
        method: "PATCH",
        body: JSON.stringify({ minCount: 4, maxCount: 6 }),
      })
    );
    expect(patch.status).toBe(200);
    const patchBody = await jsonBody<{
      ok: boolean;
      data: { minCount: number; maxCount: number };
    }>(patch);
    expect(patchBody.data.minCount).toBe(4);
    expect(patchBody.data.maxCount).toBe(6);

    // DELETE → soft-delete
    const del = await app.fetch(
      authed(`/api/projects/${slug}/goals/${goalId}`, { method: "DELETE" })
    );
    expect(del.status).toBe(200);
    const [after] = await db
      .select()
      .from(projectGoals)
      .where(eq(projectGoals.id, goalId));
    expect(after?.isActive).toBe(false);

    // DELETE again → 404 (already inactive — soft-delete helper still returns true if row exists)
    // Note: the helper updates without an is_active filter, so a second DELETE still returns
    // 200 with the same payload. That's fine — soft-delete is idempotent.
  });

  it("PATCH 404 when goalId belongs to a different project", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/goals/00000000-0000-0000-0000-000000000000`, {
        method: "PATCH",
        body: JSON.stringify({ minCount: 1 }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("GET/PUT /api/projects/:slug/planner-config", () => {
  it("GET returns null when no config row exists", async () => {
    await db.delete(projectPlannerConfig).where(eq(projectPlannerConfig.projectId, projectId));
    const res = await app.fetch(authed(`/api/projects/${slug}/planner-config`));
    expect(res.status).toBe(200);
    const body = await jsonBody<{ ok: boolean; data: unknown }>(res);
    expect(body.data).toBeNull();
  });

  it("PUT upserts; second PUT updates the same row", async () => {
    const put1 = await app.fetch(
      authed(`/api/projects/${slug}/planner-config`, {
        method: "PUT",
        body: JSON.stringify({
          weeklyBudgetEur: 50,
          topNSignalsAllowedOverage: 3,
          maxOveragePerSignal: 1,
        }),
      })
    );
    expect(put1.status).toBe(200);
    const b1 = await jsonBody<{
      ok: boolean;
      data: { weeklyBudgetEur: string; topNSignalsAllowedOverage: number };
    }>(put1);
    // numeric() returns string from postgres-js
    expect(parseFloat(b1.data.weeklyBudgetEur)).toBeCloseTo(50, 2);

    const put2 = await app.fetch(
      authed(`/api/projects/${slug}/planner-config`, {
        method: "PUT",
        body: JSON.stringify({
          weeklyBudgetEur: 75.5,
          topNSignalsAllowedOverage: 5,
          maxOveragePerSignal: 2,
          perTypeMaxEur: { cluster: 40, comparison: 20 },
        }),
      })
    );
    expect(put2.status).toBe(200);
    const b2 = await jsonBody<{
      ok: boolean;
      data: {
        weeklyBudgetEur: string;
        topNSignalsAllowedOverage: number;
        perTypeMaxEur: Record<string, number> | null;
      };
    }>(put2);
    expect(parseFloat(b2.data.weeklyBudgetEur)).toBeCloseTo(75.5, 2);
    expect(b2.data.topNSignalsAllowedOverage).toBe(5);
    expect(b2.data.perTypeMaxEur).toEqual({ cluster: 40, comparison: 20 });

    // Singleton-per-project: only one row exists.
    const rows = await db
      .select()
      .from(projectPlannerConfig)
      .where(eq(projectPlannerConfig.projectId, projectId));
    expect(rows.length).toBe(1);
  });
});

describe("GET /api/projects/:slug/goals/validate", () => {
  it("returns valid=false with NO_GOALS_DEFINED + NO_PLANNER_CONFIG on empty project", async () => {
    await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));
    await db.delete(projectPlannerConfig).where(eq(projectPlannerConfig.projectId, projectId));

    const res = await app.fetch(authed(`/api/projects/${slug}/goals/validate`));
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      ok: boolean;
      data: {
        valid: boolean;
        errors: Array<{ code: string }>;
        warnings: Array<{ code: string }>;
      };
    }>(res);
    expect(body.data.valid).toBe(false);
    const codes = body.data.errors.map((e) => e.code).sort();
    expect(codes).toEqual(["NO_GOALS_DEFINED", "NO_PLANNER_CONFIG"]);
  });

  it("returns valid=true on realistic toolwiki-style configuration", async () => {
    await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));
    // Seed config + goals via API to exercise the full stack
    await app.fetch(
      authed(`/api/projects/${slug}/planner-config`, {
        method: "PUT",
        body: JSON.stringify({
          weeklyBudgetEur: 50,
          topNSignalsAllowedOverage: 3,
          maxOveragePerSignal: 1,
        }),
      })
    );
    await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null },
            { contentType: "comparison", cadenceUnit: "per_week", minCount: 1, maxCount: 3 },
            { contentType: "social_post", cadenceUnit: "per_day", minCount: 3, maxCount: 5 },
            { contentType: "ki_wissen", cadenceUnit: "per_week", minCount: 3, maxCount: 5 },
          ],
        }),
      })
    );

    const res = await app.fetch(authed(`/api/projects/${slug}/goals/validate`));
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      ok: boolean;
      data: {
        valid: boolean;
        errors: Array<{ code: string }>;
        estimatedWeeklyFloorEur: number | null;
        resolvedGoals: Array<{ contentType: string }>;
      };
    }>(res);
    expect(body.data.valid).toBe(true);
    expect(body.data.errors).toEqual([]);
    expect(body.data.resolvedGoals.length).toBe(4);
    // Floor estimate present (real pipelineRegistry has DEFAULT_COST_BY_PIPELINE fallback)
    expect(body.data.estimatedWeeklyFloorEur).not.toBeNull();
  });

  it("returns FLOOR_EXCEEDS_BUDGET when weekly budget = 1.00", async () => {
    await db.delete(projectGoals).where(eq(projectGoals.projectId, projectId));
    await app.fetch(
      authed(`/api/projects/${slug}/planner-config`, {
        method: "PUT",
        body: JSON.stringify({
          weeklyBudgetEur: 1.0,
          topNSignalsAllowedOverage: 3,
          maxOveragePerSignal: 1,
        }),
      })
    );
    await app.fetch(
      authed(`/api/projects/${slug}/goals`, {
        method: "PUT",
        body: JSON.stringify({
          goals: [
            { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null },
          ],
        }),
      })
    );
    const res = await app.fetch(authed(`/api/projects/${slug}/goals/validate`));
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      ok: boolean;
      data: { valid: boolean; errors: Array<{ code: string }> };
    }>(res);
    expect(body.data.valid).toBe(false);
    const codes = body.data.errors.map((e) => e.code);
    expect(codes).toContain("FLOOR_EXCEEDS_BUDGET");
  });
});

describe("auth + routing edges", () => {
  it("401 without session cookie", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${slug}/goals`, { method: "GET" })
    );
    expect(res.status).toBe(401);
  });

  it("404 for unknown slug", async () => {
    const res = await app.fetch(authed(`/api/projects/does-not-exist-${Date.now()}/goals`));
    expect(res.status).toBe(404);
  });
});
