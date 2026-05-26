/**
 * Spec 65.11 — HTTP route tests for /api/projects/:slug/hooks.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  hookTemplates,
  projects,
  sessions,
  users,
} from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let slug: string;
let otherProjectId: string;
let otherSlug: string;
let sessionToken: string;
let userId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [user] = await db
    .insert(users)
    .values({
      email: `hooks-routes-${ts}@test.local`,
      name: "Hooks Routes Test",
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

  slug = `hooks-routes-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Hooks Routes Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  otherSlug = `hooks-other-${ts}`;
  const [other] = await db
    .insert(projects)
    .values({
      slug: otherSlug,
      name: "Hooks Other",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  otherProjectId = other!.id;
});

afterEach(async () => {
  await db.delete(hookTemplates).where(eq(hookTemplates.projectId, projectId));
  await db.delete(hookTemplates).where(eq(hookTemplates.projectId, otherProjectId));
});

afterAll(async () => {
  await db.delete(hookTemplates).where(eq(hookTemplates.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(projects).where(eq(projects.id, otherProjectId));
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

describe("POST /api/projects/:slug/hooks", () => {
  it("creates a hook with declared variables", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks`, {
        method: "POST",
        body: JSON.stringify({
          formatType: "story_arc_clickbait",
          pattern: "Ich habe meinen {profession}-Job verloren — wegen {tool}",
          language: "de",
          variables: ["profession", "tool"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { hook: { id: string; pattern: string; variables: string[] } };
    };
    expect(body.data.hook.variables).toEqual(["profession", "tool"]);
  });

  it("rejects pattern referencing undeclared variables (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks`, {
        method: "POST",
        body: JSON.stringify({
          formatType: "story_arc_clickbait",
          pattern: "Ich habe meinen {profession}-Job verloren — wegen {tool} und {role}",
          language: "de",
          variables: ["profession", "tool"], // missing `role`
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("role");
  });
});

describe("GET /api/projects/:slug/hooks", () => {
  it("filters by formatType + language", async () => {
    await db.insert(hookTemplates).values([
      {
        projectId,
        formatType: "story_arc_clickbait",
        pattern: "DE story {tool}",
        language: "de",
        variables: ["tool"],
      },
      {
        projectId,
        formatType: "story_arc_clickbait",
        pattern: "EN story {tool}",
        language: "en",
        variables: ["tool"],
      },
      {
        projectId,
        formatType: "lifestyle_listicle",
        pattern: "DE lifestyle {tool}",
        language: "de",
        variables: ["tool"],
      },
    ]);

    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks?formatType=story_arc_clickbait&language=de`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { hooks: Array<{ pattern: string }> } };
    expect(body.data.hooks).toHaveLength(1);
    expect(body.data.hooks[0]!.pattern).toBe("DE story {tool}");
  });
});

describe("PATCH /api/projects/:slug/hooks/:id", () => {
  it("updates pattern + variables", async () => {
    const [hook] = await db
      .insert(hookTemplates)
      .values({
        projectId,
        formatType: "story_arc_clickbait",
        pattern: "{tool}",
        language: "de",
        variables: ["tool"],
      })
      .returning({ id: hookTemplates.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks/${hook!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          pattern: "Hallo {tool} mit {context}",
          variables: ["tool", "context"],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(hookTemplates)
      .where(eq(hookTemplates.id, hook!.id));
    expect(rows[0]!.pattern).toBe("Hallo {tool} mit {context}");
  });

  it("rejects cross-project (404)", async () => {
    const [foreign] = await db
      .insert(hookTemplates)
      .values({
        projectId: otherProjectId,
        formatType: "story_arc_clickbait",
        pattern: "{tool}",
        language: "de",
        variables: ["tool"],
      })
      .returning({ id: hookTemplates.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks/${foreign!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pattern: "hijack {tool}" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:slug/hooks/:id/active", () => {
  it("flips isActive", async () => {
    const [hook] = await db
      .insert(hookTemplates)
      .values({
        projectId,
        formatType: "story_arc_clickbait",
        pattern: "{tool}",
        language: "de",
        variables: ["tool"],
        isActive: true,
      })
      .returning({ id: hookTemplates.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/hooks/${hook!.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(hookTemplates)
      .where(eq(hookTemplates.id, hook!.id));
    expect(rows[0]!.isActive).toBe(false);
  });
});
