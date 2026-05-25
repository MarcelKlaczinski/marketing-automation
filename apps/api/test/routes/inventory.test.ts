// Spec 64.20 — HTTP route tests for /api/projects/:slug/inventory.
// Pattern mirrors briefs-create.test.ts: bun:test with real DB, app.fetch.
//
// Worker integration tests are skipped here intentionally — the worker is glue
// over already-tested adapter + helpers. Cron-seed is unit-tested in
// inventory-cron-seed.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  contentSourceInventory,
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
let otherProjectId: string;
let otherSlug: string;
let toolsArticleId: string;
let blogArticleId: string;
let sessionToken: string;
let userId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [user] = await db
    .insert(users)
    .values({
      email: `inventory-routes-${ts}@test.local`,
      name: "Inventory Routes Test",
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

  slug = `inventory-routes-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Inventory Routes Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  // Cross-tenant guard fixture
  otherSlug = `inventory-other-${ts}`;
  const [other] = await db
    .insert(projects)
    .values({
      slug: otherSlug,
      name: "Inventory Other Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  otherProjectId = other!.id;

  const [toolsArt] = await db
    .insert(articles)
    .values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "de",
      slug: `inv-tool-${ts}`,
      title: "Inv Tool",
      status: "proposed",
    })
    .returning({ id: articles.id });
  toolsArticleId = toolsArt!.id;

  const [blogArt] = await db
    .insert(articles)
    .values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: `inv-blog-${ts}`,
      title: "Inv Blog",
      status: "proposed",
    })
    .returning({ id: articles.id });
  blogArticleId = blogArt!.id;
});

afterEach(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
  await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.projectId, otherProjectId));
});

afterAll(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
  await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.projectId, otherProjectId));
  await db.delete(articles).where(eq(articles.projectId, projectId));
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

describe("POST /api/projects/:slug/inventory", () => {
  it("creates a tool row pre-approved by default", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          source: "github",
          objectType: "tool",
          sourceIdentifier: "anthropics/claude-code",
          displayName: "Claude Code",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: typeof contentSourceInventory.$inferSelect;
    };
    expect(body.ok).toBe(true);
    expect(body.data.objectType).toBe("tool");
    expect(body.data.fetchStatus).toBe("pending");
    expect(body.data.approvedAt).not.toBeNull();
    expect(body.data.approvedByUserId).toBe(userId);
    expect(body.data.refreshIntervalHours).toBe(168);
  });

  it("creates a skill row with mono-repo source identifier", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "skill",
          sourceIdentifier: "anthropics/skills:web-design",
          displayName: "Web Design Skill",
          refreshIntervalHours: 720,
          approveOnCreate: false,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: typeof contentSourceInventory.$inferSelect };
    expect(body.data.sourceIdentifier).toBe("anthropics/skills:web-design");
    expect(body.data.approvedAt).toBeNull();
  });

  it("rejects articleId pointing to a non-tools article (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "bad/link",
          displayName: "Bad link",
          articleId: blogArticleId,
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("article_collection_mismatch");
  });

  it("accepts articleId pointing to a tools article", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "good/link",
          displayName: "Good link",
          articleId: toolsArticleId,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: typeof contentSourceInventory.$inferSelect };
    expect(body.data.articleId).toBe(toolsArticleId);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await app.fetch(
      authed(`/api/projects/does-not-exist/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "x/y",
          displayName: "X",
        }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug/inventory", () => {
  it("lists rows with counts; filters by objectType", async () => {
    // Seed mixed
    await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "list/tool",
          displayName: "List Tool",
        }),
      }),
    );
    await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "skill",
          sourceIdentifier: "list/skill",
          displayName: "List Skill",
        }),
      }),
    );

    const all = await app.fetch(authed(`/api/projects/${slug}/inventory`));
    const allBody = (await all.json()) as {
      data: {
        items: (typeof contentSourceInventory.$inferSelect)[];
        counts: { tool: number; skill: number };
      };
    };
    expect(allBody.data.items.length).toBe(2);
    expect(allBody.data.counts.tool).toBe(1);
    expect(allBody.data.counts.skill).toBe(1);

    const onlyTools = await app.fetch(authed(`/api/projects/${slug}/inventory?objectType=tool`));
    const onlyToolsBody = (await onlyTools.json()) as {
      data: { items: (typeof contentSourceInventory.$inferSelect)[] };
    };
    expect(onlyToolsBody.data.items.length).toBe(1);
    expect(onlyToolsBody.data.items[0]?.objectType).toBe("tool");
  });
});

describe("PATCH /api/projects/:slug/inventory/:id", () => {
  it("updates displayName + refreshIntervalHours", async () => {
    const createRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "patch/target",
          displayName: "Old Name",
        }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    const patchRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "New Name", refreshIntervalHours: 24 }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { data: typeof contentSourceInventory.$inferSelect };
    expect(body.data.displayName).toBe("New Name");
    expect(body.data.refreshIntervalHours).toBe(24);
  });

  it("rejects cross-tenant access (404)", async () => {
    // Create in other project
    const createRes = await app.fetch(
      authed(`/api/projects/${otherSlug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "cross/tenant",
          displayName: "Cross",
        }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    // Attempt to PATCH from the OTHER project's slug
    const patchRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Hijacked" }),
      }),
    );
    expect(patchRes.status).toBe(404);
  });
});

describe("DELETE /api/projects/:slug/inventory/:id", () => {
  it("hard-deletes the row", async () => {
    const createRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "del/target",
          displayName: "To delete",
        }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    const delRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory/${created.id}`, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);

    // Verify gone via GET
    const listRes = await app.fetch(authed(`/api/projects/${slug}/inventory`));
    const listBody = (await listRes.json()) as {
      data: { items: (typeof contentSourceInventory.$inferSelect)[] };
    };
    expect(listBody.data.items.find((r) => r.id === created.id)).toBeUndefined();
  });
});

describe("POST /api/projects/:slug/inventory/refresh", () => {
  it("enqueues cron-triggered job on empty body", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/refresh`, { method: "POST", body: "" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { jobId: string; mode: string } };
    expect(body.data.mode).toBe("due-now");
    expect(body.data.jobId).toMatch(/^inventory-refresh-/);
  });

  it("enqueues refresh-manual job when ids provided", async () => {
    const createRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "refresh/by-id",
          displayName: "Refresh by id",
        }),
      }),
    );
    const { data: created } = (await createRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    const refreshRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory/refresh`, {
        method: "POST",
        body: JSON.stringify({ ids: [created.id] }),
      }),
    );
    const body = (await refreshRes.json()) as { data: { mode: string } };
    expect(body.data.mode).toBe("manual");
  });
});
