/**
 * Spec 65.11 — HTTP route tests for /api/projects/:slug/end-slides.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  endSlideDefinitions,
  eq,
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
      email: `end-slides-${ts}@test.local`,
      name: "End-Slides Routes Test",
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

  slug = `end-slides-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "End-Slides Routes Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  otherSlug = `end-slides-other-${ts}`;
  const [other] = await db
    .insert(projects)
    .values({
      slug: otherSlug,
      name: "End-Slides Other",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  otherProjectId = other!.id;
});

afterEach(async () => {
  await db.delete(endSlideDefinitions).where(eq(endSlideDefinitions.projectId, projectId));
  await db.delete(endSlideDefinitions).where(eq(endSlideDefinitions.projectId, otherProjectId));
});

afterAll(async () => {
  await db.delete(endSlideDefinitions).where(eq(endSlideDefinitions.projectId, projectId));
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

describe("POST /api/projects/:slug/end-slides", () => {
  it("creates a follow-cta with valid config", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides`, {
        method: "POST",
        body: JSON.stringify({
          name: "Follow @toolwiki",
          type: "follow-cta",
          config: { handle: "@toolwiki.ai" },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { endSlide: { id: string; type: string; config: { handle: string } } };
    };
    expect(body.data.endSlide.type).toBe("follow-cta");
    expect(body.data.endSlide.config.handle).toBe("@toolwiki.ai");
  });

  it("rejects invalid config for declared type (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides`, {
        method: "POST",
        body: JSON.stringify({
          name: "Broken comment-to-get",
          type: "comment-to-get",
          // keyword min(2), missing resourceTitle
          config: { keyword: "A" },
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects unknown type (422 via Zod enum)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides`, {
        method: "POST",
        body: JSON.stringify({
          name: "Mystery",
          type: "future-type",
          config: {},
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/projects/:slug/end-slides/:id", () => {
  it("re-validates config under existing type", async () => {
    const [row] = await db
      .insert(endSlideDefinitions)
      .values({
        projectId,
        name: "Tag friend",
        type: "tag-friend",
        config: { prompt: "Wer braucht das?" },
      })
      .returning({ id: endSlideDefinitions.id });

    // Try to patch config with incompatible shape — prompt must be ≥ 2 chars.
    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides/${row!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config: { prompt: "A" } }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects cross-project (404)", async () => {
    const [foreign] = await db
      .insert(endSlideDefinitions)
      .values({
        projectId: otherProjectId,
        name: "Foreign",
        type: "follow-cta",
        config: { handle: "@nope" },
      })
      .returning({ id: endSlideDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides/${foreign!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Hijack" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:slug/end-slides/:id/active", () => {
  it("flips isActive", async () => {
    const [row] = await db
      .insert(endSlideDefinitions)
      .values({
        projectId,
        name: "Toggle me",
        type: "follow-cta",
        config: { handle: "@x" },
        isActive: true,
      })
      .returning({ id: endSlideDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides/${row!.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(endSlideDefinitions)
      .where(eq(endSlideDefinitions.id, row!.id));
    expect(rows[0]!.isActive).toBe(false);
  });
});

describe("GET /api/projects/:slug/end-slides", () => {
  it("filters by type", async () => {
    await db.insert(endSlideDefinitions).values([
      { projectId, name: "f1", type: "follow-cta", config: { handle: "@a" } },
      { projectId, name: "c1", type: "comment-to-get", config: { keyword: "GO", resourceTitle: "Pack" } },
      { projectId, name: "f2", type: "follow-cta", config: { handle: "@b" } },
    ]);
    const res = await app.fetch(
      authed(`/api/projects/${slug}/end-slides?type=follow-cta`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { endSlides: Array<{ name: string }> } };
    expect(body.data.endSlides).toHaveLength(2);
    expect(body.data.endSlides.map((e) => e.name).sort()).toEqual(["f1", "f2"]);
  });
});
