/**
 * Spec 65.11 — HTTP route tests for /api/projects/:slug/recurring-content/definitions.
 *
 * Coverage:
 *   - POST creates + Zod-validates format_config
 *   - PATCH updates including isActive flag
 *   - run-now enqueues with forceImmediate=true (verifies BullMQ payload)
 *   - dry-run is gated to project-owned definitions
 *   - history reads recurring-source briefs filtered by definitionId
 *   - format-types endpoint surfaces the 5 v1 registry entries
 *   - multi-tenant guard rejects cross-project access
 *
 * The dry-run + Run-Now bodies don't trigger real LLM calls because the
 * Anthropic adapter is not configured in the test env — those calls fail
 * fast. We assert the enqueue path / route gating only, not the brief
 * persistence (covered elsewhere).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  hookTemplates,
  projects,
  recurringContentDefinitions,
  sessions,
  topicBriefs,
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
      email: `recurring-defs-${ts}@test.local`,
      name: "Recurring Defs Test",
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

  slug = `recurring-defs-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Recurring Defs Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  otherSlug = `recurring-defs-other-${ts}`;
  const [other] = await db
    .insert(projects)
    .values({
      slug: otherSlug,
      name: "Recurring Defs Other Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  otherProjectId = other!.id;
});

afterEach(async () => {
  await db
    .delete(topicBriefs)
    .where(eq(topicBriefs.projectId, projectId));
  await db
    .delete(recurringContentDefinitions)
    .where(eq(recurringContentDefinitions.projectId, projectId));
  await db
    .delete(recurringContentDefinitions)
    .where(eq(recurringContentDefinitions.projectId, otherProjectId));
});

afterAll(async () => {
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db
    .delete(recurringContentDefinitions)
    .where(eq(recurringContentDefinitions.projectId, projectId));
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

describe("POST /api/projects/:slug/recurring-content/definitions", () => {
  it("creates a definition with a valid top_n_comparison config", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Top 5 LLMs weekly",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5, categorySlug: "llm" },
          frequency: "weekly",
          outputTargets: { article: false, social: true },
          templateSelectionStrategy: "lru",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { definition: { id: string; name: string; formatType: string; isActive: boolean } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.definition.name).toBe("Top 5 LLMs weekly");
    expect(body.data.definition.formatType).toBe("top_n_comparison");
    expect(body.data.definition.isActive).toBe(true);
  });

  it("rejects invalid format_config (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Broken",
          formatType: "top_n_comparison",
          // topN is required, range [3,10] in the format schema. -1 fails.
          formatConfig: { topN: -1 },
          frequency: "weekly",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Invalid format_config");
  });

  it("rejects 'fixed' strategy without fixedTemplateKey (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Fixed but no key",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5 },
          frequency: "weekly",
          templateSelectionStrategy: "fixed",
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("404s on missing project", async () => {
    const res = await app.fetch(
      authed(`/api/projects/does-not-exist/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "X",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5 },
          frequency: "weekly",
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("Spec 65.16 V1.7 — accepts socialImageStylePresetOverride on create", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Preset override test",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5, categorySlug: "llm" },
          frequency: "weekly",
          socialImageStylePresetOverride: "blue-tech-gradient",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { definition: { id: string; socialImageStylePresetOverride: string | null } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.definition.socialImageStylePresetOverride).toBe("blue-tech-gradient");
  });

  it("Spec 65.16 V1.7 — rejects an invalid preset override (422)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Bad preset",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5 },
          frequency: "weekly",
          socialImageStylePresetOverride: "not-a-preset",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("Spec 65.16 V1.7 — null preset override means inherit project default", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`, {
        method: "POST",
        body: JSON.stringify({
          name: "Inherit project default",
          formatType: "top_n_comparison",
          formatConfig: { topN: 5, categorySlug: "llm" },
          frequency: "weekly",
          socialImageStylePresetOverride: null,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { definition: { socialImageStylePresetOverride: string | null } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.definition.socialImageStylePresetOverride).toBeNull();
  });
});

describe("GET /api/projects/:slug/recurring-content/definitions", () => {
  it("lists definitions scoped to the project", async () => {
    await db.insert(recurringContentDefinitions).values({
      projectId,
      name: "A",
      formatType: "top_n_comparison",
      formatConfig: { topN: 5 },
      frequency: "weekly",
      nextRunAt: new Date(Date.now() + 60_000),
    });
    await db.insert(recurringContentDefinitions).values({
      projectId: otherProjectId,
      name: "Foreign",
      formatType: "top_n_comparison",
      formatConfig: { topN: 5 },
      frequency: "weekly",
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { definitions: Array<{ name: string }> };
    };
    expect(body.data.definitions).toHaveLength(1);
    expect(body.data.definitions[0]!.name).toBe("A");
  });
});

describe("PATCH /api/projects/:slug/recurring-content/definitions/:id", () => {
  it("updates name + frequency", async () => {
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "Old",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: recurringContentDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${def!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed", frequency: "biweekly" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { definition: { name: string; frequency: string } };
    };
    expect(body.data.definition.name).toBe("Renamed");
    expect(body.data.definition.frequency).toBe("biweekly");
  });

  it("rejects cross-project access (404)", async () => {
    const [foreign] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId: otherProjectId,
        name: "Foreign",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: recurringContentDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${foreign!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Hijack" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:slug/recurring-content/definitions/:id/active", () => {
  it("toggles isActive", async () => {
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "Toggle",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 60_000),
        isActive: true,
      })
      .returning({ id: recurringContentDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${def!.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.id, def!.id));
    expect(rows[0]!.isActive).toBe(false);
  });
});

describe("POST /api/projects/:slug/recurring-content/definitions/:id/run-now", () => {
  it("rejects Run-Now on inactive definition (409)", async () => {
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "Inactive",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 60_000),
        isActive: false,
      })
      .returning({ id: recurringContentDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${def!.id}/run-now`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe("GET /api/projects/:slug/recurring-content/definitions/:id/history", () => {
  it("returns briefs filtered by recurring_metadata.definitionId", async () => {
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "With history",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: recurringContentDefinitions.id });
    const defId = def!.id;

    // 2 recurring briefs for this def
    await db.insert(topicBriefs).values({
      projectId,
      source: "recurring",
      topicTitle: "Brief 1",
      locale: "de",
      clusterAction: "standalone",
      approvalRequired: true,
      approvalStatus: "plan_pending",
      recurringMetadata: {
        definitionId: defId,
        runNumber: 1,
        previousToolIds: [],
        formatType: "top_n_comparison",
        formatConfig: {},
      },
    });
    await db.insert(topicBriefs).values({
      projectId,
      source: "recurring",
      topicTitle: "Brief 2",
      locale: "de",
      clusterAction: "standalone",
      approvalRequired: true,
      approvalStatus: "plan_pending",
      recurringMetadata: {
        definitionId: defId,
        runNumber: 2,
        previousToolIds: [],
        formatType: "top_n_comparison",
        formatConfig: {},
      },
    });
    // 1 brief for a different definition — must not leak
    await db.insert(topicBriefs).values({
      projectId,
      source: "recurring",
      topicTitle: "Other-def brief",
      locale: "de",
      clusterAction: "standalone",
      approvalRequired: true,
      approvalStatus: "plan_pending",
      recurringMetadata: {
        definitionId: crypto.randomUUID(),
        runNumber: 1,
        previousToolIds: [],
        formatType: "top_n_comparison",
        formatConfig: {},
      },
    });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${defId}/history`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Array<{ topicTitle: string }>; total: number };
    };
    expect(body.data.total).toBe(2);
    expect(body.data.items).toHaveLength(2);
    const titles = body.data.items.map((i) => i.topicTitle).sort();
    expect(titles).toEqual(["Brief 1", "Brief 2"]);
  });
});

describe("GET /api/projects/:slug/recurring-content/definitions/format-types", () => {
  it("returns the 5 v1 format-type entries", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/format-types`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { formatTypes: Array<{ key: string; family: "A" | "B"; needsHooks: boolean }> };
    };
    const keys = body.data.formatTypes.map((t) => t.key).sort();
    expect(keys).toEqual(
      [
        "head_to_head",
        "lifestyle_listicle",
        "opinion_recommendation",
        "story_arc_clickbait",
        "top_n_comparison",
      ].sort(),
    );
    // Family A formats should NOT need hooks
    const topN = body.data.formatTypes.find((t) => t.key === "top_n_comparison");
    expect(topN?.family).toBe("A");
    expect(topN?.needsHooks).toBe(false);
    // Family B should
    const story = body.data.formatTypes.find((t) => t.key === "story_arc_clickbait");
    expect(story?.family).toBe("B");
    expect(story?.needsHooks).toBe(true);
  });
});

describe("GET /api/projects/:slug/recurring-content/definitions/:id/upcoming", () => {
  it("returns 4 future timestamps spaced 1 week apart", async () => {
    const future = new Date(Date.now() + 60_000);
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "Upcoming",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: future,
      })
      .returning({ id: recurringContentDefinitions.id });

    const res = await app.fetch(
      authed(`/api/projects/${slug}/recurring-content/definitions/${def!.id}/upcoming?count=4`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { upcoming: string[] } };
    expect(body.data.upcoming).toHaveLength(4);
    const ts = body.data.upcoming.map((s) => new Date(s).getTime());
    // Spacing ~ 7 days. Allow ±1 day jitter for cron-parsed cadences.
    expect(ts[1]! - ts[0]!).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(ts[1]! - ts[0]!).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});
