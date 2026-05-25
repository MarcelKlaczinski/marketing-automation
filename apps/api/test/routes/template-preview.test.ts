// Spec 65.0 Day 4 — POST /api/projects/:slug/templates/:key/preview HTTP tests.
//
// Covers auth gate + 404 paths. The actual-render happy-path needs a full
// Remotion bundle (5-10s per render) and is verified manually for V1; the
// existing `packages/social/scripts/visual-render-all.ts` harness covers
// the render-server functions themselves.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  projects,
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
  const ts = Date.now();
  const [user] = await db
    .insert(users)
    .values({
      email: `preview-test-${ts}@test.local`,
      name: "Preview Test User",
      role: "owner",
    })
    .returning({ id: users.id });
  if (!user) throw new Error("Failed to seed user");
  userId = user.id;

  sessionToken = `tok-${crypto.randomUUID()}`;
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  slug = `preview-route-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Preview Route Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  if (!proj) throw new Error("Failed to seed project");
  projectId = proj.id;
});

afterAll(async () => {
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

describe("POST /:slug/templates/:templateKey/preview (Spec 65.0 Day 4)", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${slug}/templates/comparison-grid-4/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleData: {} }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown project slug", async () => {
    const res = await app.fetch(
      authed(`/api/projects/nonexistent-${Date.now()}/templates/comparison-grid-4/preview`, {
        method: "POST",
        body: JSON.stringify({ sampleData: {} }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("project_not_found");
  });

  it("returns 404 for an unknown template key", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/templates/no-such-template/preview`, {
        method: "POST",
        body: JSON.stringify({ sampleData: {} }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("template_not_found");
  });

  it("rejects body missing required sampleData with 400 via zValidator", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/templates/comparison-grid-4/preview`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});
