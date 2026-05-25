// Spec 64.20 — HTTP route tests for /api/projects/:slug/inventory.
// Pattern mirrors briefs-create.test.ts: bun:test with real DB, app.fetch.
//
// Worker integration tests are skipped here intentionally — the worker is glue
// over already-tested adapter + helpers. Cron-seed is unit-tested in
// inventory-cron-seed.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  and,
  articles,
  contentSourceInventory,
  cronState,
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
  // A2 T2: prune any cron_state rows left by the cron-status tests so the next
  // test sees clean defaults from the GET endpoint.
  await db
    .delete(cronState)
    .where(
      and(
        eq(cronState.projectId, projectId),
        // Both job types we touch in tests below:
        // - github_inventory_refresh
        // - github_inventory_discovery
        // The eq() check serves as a noop guard if the seed never ran.
        eq(cronState.jobType, "github_inventory_discovery"),
      ),
    );
  await db
    .delete(cronState)
    .where(
      and(
        eq(cronState.projectId, projectId),
        eq(cronState.jobType, "github_inventory_refresh"),
      ),
    );
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

// ─── A2 Tranche 2 — bulk approve/reject + cron-status ──────────────────────

describe("POST /api/projects/:slug/inventory/discovery/approve", () => {
  it("flips approved_at on unapproved rows and reports counts", async () => {
    // Seed an unapproved candidate (approveOnCreate:false) + an already-approved row.
    const unapproved = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "bulk/unapproved",
          displayName: "Unapproved",
          approveOnCreate: false,
        }),
      }),
    );
    const { data: u } = (await unapproved.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };
    const approvedRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "bulk/approved",
          displayName: "Already-Approved",
        }),
      }),
    );
    const { data: a } = (await approvedRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };
    expect(u.approvedAt).toBeNull();
    expect(a.approvedAt).not.toBeNull();

    // Throw in a UUID that doesn't exist so we exercise notFound counting too.
    const ghostId = crypto.randomUUID();

    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/discovery/approve`, {
        method: "POST",
        body: JSON.stringify({ ids: [u.id, a.id, ghostId] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { approved: number; alreadyApproved: number; notFound: number };
    };
    expect(body.data).toEqual({ approved: 1, alreadyApproved: 1, notFound: 1 });

    // Verify the unapproved row is now approved (no GET /:id endpoint — query DB).
    const refreshed = await db
      .select({
        approvedAt: contentSourceInventory.approvedAt,
        approvedByUserId: contentSourceInventory.approvedByUserId,
      })
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.id, u.id));
    expect(refreshed.length).toBe(1);
    expect(refreshed[0]?.approvedAt).not.toBeNull();
    expect(refreshed[0]?.approvedByUserId).toBe(userId);
  });

  it("ignores cross-tenant IDs (counted as notFound, not approved)", async () => {
    // Create an unapproved row in the OTHER project.
    const otherRes = await app.fetch(
      authed(`/api/projects/${otherSlug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "cross/tenant-approve",
          displayName: "Cross-tenant",
          approveOnCreate: false,
        }),
      }),
    );
    const { data: cross } = (await otherRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    // Approve via THIS project's slug — must be a no-op.
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/discovery/approve`, {
        method: "POST",
        body: JSON.stringify({ ids: [cross.id] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { approved: number; alreadyApproved: number; notFound: number };
    };
    expect(body.data).toEqual({ approved: 0, alreadyApproved: 0, notFound: 1 });

    // Verify the row in the OTHER project is still unapproved (direct DB
    // query — no GET /:id endpoint exists).
    const otherRows = await db
      .select({ approvedAt: contentSourceInventory.approvedAt })
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.id, cross.id));
    expect(otherRows.length).toBe(1);
    expect(otherRows[0]?.approvedAt).toBeNull();
  });
});

describe("POST /api/projects/:slug/inventory/discovery/reject", () => {
  it("hard-deletes unapproved rows and skips approved ones", async () => {
    const unapprovedRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "reject/pending",
          displayName: "Will be rejected",
          approveOnCreate: false,
        }),
      }),
    );
    const { data: u } = (await unapprovedRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };
    const approvedRes = await app.fetch(
      authed(`/api/projects/${slug}/inventory`, {
        method: "POST",
        body: JSON.stringify({
          objectType: "tool",
          sourceIdentifier: "reject/approved",
          displayName: "Survives reject",
        }),
      }),
    );
    const { data: a } = (await approvedRes.json()) as {
      data: typeof contentSourceInventory.$inferSelect;
    };

    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/discovery/reject`, {
        method: "POST",
        body: JSON.stringify({ ids: [u.id, a.id] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { rejected: number; skipped: number };
    };
    expect(body.data).toEqual({ rejected: 1, skipped: 1 });

    // No GET /:id endpoint exists, so verify state via direct DB query:
    // unapproved row was hard-deleted; approved row survives untouched.
    const remaining = await db
      .select({ id: contentSourceInventory.id })
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).not.toContain(u.id);
    expect(remainingIds).toContain(a.id);
  });
});

describe("GET /api/projects/:slug/inventory/cron-status", () => {
  it("returns defaults when no cron_state rows exist", async () => {
    const res = await app.fetch(authed(`/api/projects/${slug}/inventory/cron-status`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        refresh: { isActive: boolean; cronPattern: string; lastRunAt: string | null };
        discovery: { isActive: boolean; cronPattern: string; lastRunAt: string | null };
      };
    };
    // Defaults: refresh ON (matches GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN),
    // discovery OFF (matches GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN).
    expect(body.data.refresh.isActive).toBe(true);
    expect(body.data.refresh.cronPattern).toBeTruthy();
    expect(body.data.refresh.lastRunAt).toBeNull();
    expect(body.data.discovery.isActive).toBe(false);
    expect(body.data.discovery.cronPattern).toBeTruthy();
    expect(body.data.discovery.lastRunAt).toBeNull();
  });
});

describe("PATCH /api/projects/:slug/inventory/cron-status", () => {
  it("toggles discovery cron on and persists to cron_state", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/cron-status`, {
        method: "PATCH",
        body: JSON.stringify({
          jobType: "github_inventory_discovery",
          isActive: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { jobType: string; isActive: boolean; cronPattern: string };
    };
    expect(body.data.isActive).toBe(true);
    expect(body.data.jobType).toBe("github_inventory_discovery");

    // Verify GET now reports the new state.
    const after = await app.fetch(authed(`/api/projects/${slug}/inventory/cron-status`));
    const afterBody = (await after.json()) as {
      data: { discovery: { isActive: boolean } };
    };
    expect(afterBody.data.discovery.isActive).toBe(true);

    // Verify the cron_state row landed.
    const rows = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "github_inventory_discovery"),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.isActive).toBe(true);
  });

  it("rejects unknown jobType (400)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/inventory/cron-status`, {
        method: "PATCH",
        body: JSON.stringify({
          jobType: "bogus_job_type",
          isActive: true,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
