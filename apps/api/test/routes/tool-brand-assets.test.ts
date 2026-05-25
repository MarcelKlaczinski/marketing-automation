// Spec 65.2 — Tool brand-assets API smoke tests. Mirrors the briefs-create
// pattern: real DB + per-suite project + session-cookie auth via app.fetch.
//
// Covers GET list + stats, PATCH auto-flip on color save, PATCH 404 when no
// row exists, reresolve preserves Marcel-curated fields, upload validation +
// happy path, multi-domain usage helper.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  getBrandAssetsForTool,
  projects,
  sessions,
  toolBrandAssets,
  upsertBrandAsset,
  users,
} from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let projectSlug: string;
let otherProjectId: string;
let sessionToken: string;
let userId: string;
let toolId: string;
let toolSlug: string;
let toolWithoutAssetId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [user] = await db
    .insert(users)
    .values({
      email: `tba-routes-${ts}@test.local`,
      name: "TBA Routes Test",
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

  projectSlug = `tba-routes-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug: projectSlug,
      name: "TBA Routes Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  // Sibling project — used for multi-domain usage test
  const [otherProj] = await db
    .insert(projects)
    .values({
      slug: `tba-routes-other-${ts}`,
      name: "TBA Routes Other",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  otherProjectId = otherProj!.id;

  toolSlug = `claude-${ts}`;
  const [tool] = await db
    .insert(articles)
    .values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "de",
      slug: toolSlug,
      title: "Claude",
      status: "proposed",
    })
    .returning({ id: articles.id });
  toolId = tool!.id;

  const [tool2] = await db
    .insert(articles)
    .values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "de",
      slug: `gpt-${ts}`,
      title: "GPT",
      status: "proposed",
    })
    .returning({ id: articles.id });
  toolWithoutAssetId = tool2!.id;

  // Sibling tool in the OTHER project with same slug as `toolSlug` — usage helper
  // should count this as a cross-project sibling.
  await db.insert(articles).values({
    projectId: otherProjectId,
    source: "imported",
    collection: "tools",
    locale: "de",
    slug: toolSlug,
    title: "Claude (other tenant)",
    status: "proposed",
  });

  // Seed an existing row for `toolId` so PATCH + reresolve have something to load.
  await upsertBrandAsset({
    toolId,
    logoUrl: "https://r2.test/seed/claude.svg",
    primaryColor: null,
    secondaryColor: null,
    brandNameCanonical: "Claude",
    source: "lobe-icons",
    needsReview: true,
    fetchedAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(toolBrandAssets).where(eq(toolBrandAssets.toolId, toolId));
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

describe("GET /api/projects/:slug/tool-brand-assets", () => {
  it("returns items + stats; LEFT JOIN includes tools without rows", async () => {
    const res = await app.fetch(authed(`/api/projects/${projectSlug}/tool-brand-assets`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      data: {
        items: Array<{ toolId: string; needsReview: boolean | null; source: string | null }>;
        stats: { total: number; needsReview: number; complete: number; missing: number };
      };
    };
    expect(body.ok).toBe(true);
    // 2 tool-articles in this project: one with row, one without.
    expect(body.data.stats.total).toBe(2);
    expect(body.data.stats.needsReview).toBe(1);
    expect(body.data.stats.missing).toBe(1);

    const withRow = body.data.items.find((i) => i.toolId === toolId);
    const withoutRow = body.data.items.find((i) => i.toolId === toolWithoutAssetId);
    expect(withRow?.source).toBe("lobe-icons");
    expect(withoutRow?.source).toBeNull();
  });

  it("filters by needsReview=true", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets?needsReview=true`),
    );
    const body = (await res.json()) as {
      data: { items: Array<{ toolId: string }> };
    };
    const ids = body.data.items.map((i) => i.toolId);
    expect(ids).toContain(toolId);
    expect(ids).not.toContain(toolWithoutAssetId);
  });

  it("returns 404 for unknown project", async () => {
    const res = await app.fetch(authed("/api/projects/does-not-exist/tool-brand-assets"));
    expect(res.status).toBe(404);
  });

  it("filters to project's primary locale (no EN-sibling duplicates — Spec 65.2 follow-up)", async () => {
    // Seed an EN sibling of `toolSlug` in THIS project — it must NOT appear
    // in the list when the project's primary locale is 'de'.
    const ts = Date.now();
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "en",
      slug: `${toolSlug}-en-sibling-${ts}`,
      title: "Claude EN",
      status: "proposed",
    });
    // Also add a 'plain' EN tool with the SAME slug as the original DE Claude
    // — most realistic scenario for the AnyWord bug.
    const enSlug = `claude-bilingual-${ts}`;
    await db.insert(articles).values([
      {
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: enSlug,
        title: "Bilingual DE",
        status: "proposed",
      },
      {
        projectId,
        source: "imported",
        collection: "tools",
        locale: "en",
        slug: enSlug,
        title: "Bilingual EN",
        status: "proposed",
      },
    ]);

    const res = await app.fetch(authed(`/api/projects/${projectSlug}/tool-brand-assets`));
    const body = (await res.json()) as {
      data: {
        items: Array<{ toolLocale: string; toolSlug: string }>;
        primaryLocale: string;
      };
    };
    expect(body.data.primaryLocale).toBe("de");
    // EVERY row must be locale='de' — no EN siblings leak through.
    for (const row of body.data.items) {
      expect(row.toolLocale).toBe("de");
    }
    // The new bilingual slug appears EXACTLY ONCE (the DE row), not twice.
    const matches = body.data.items.filter((i) => i.toolSlug === enSlug);
    expect(matches.length).toBe(1);
  });
});

describe("PATCH /api/projects/:slug/tool-brand-assets/:toolId", () => {
  it("auto-flips needs_review=false when both colors land", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${toolId}`, {
        method: "PATCH",
        body: JSON.stringify({
          primaryColor: "#7B61FF",
          secondaryColor: "#FBF1E8",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { needsReview: boolean; primaryColor: string };
    };
    expect(body.data.primaryColor).toBe("#7B61FF");
    expect(body.data.needsReview).toBe(false);
  });

  it("rejects malformed hex color", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${toolId}`, {
        method: "PATCH",
        body: JSON.stringify({ primaryColor: "purple" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("respects explicit needsReview override (no auto-flip when caller sets it)", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${toolId}`, {
        method: "PATCH",
        body: JSON.stringify({
          primaryColor: "#000000",
          secondaryColor: "#FFFFFF",
          needsReview: true,
        }),
      }),
    );
    const body = (await res.json()) as { data: { needsReview: boolean } };
    expect(body.data.needsReview).toBe(true);
  });

  it("creates the row when none exists (INSERT-or-UPDATE — Spec 65.2 follow-up)", async () => {
    // Pre-condition: toolWithoutAssetId has no tool_brand_assets row.
    const before = await getBrandAssetsForTool(toolWithoutAssetId);
    expect(before).toBeNull();

    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${toolWithoutAssetId}`, {
        method: "PATCH",
        body: JSON.stringify({
          primaryColor: "#000000",
          secondaryColor: "#FFFFFF",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { primaryColor: string; secondaryColor: string; source: string; needsReview: boolean };
    };
    // Source defaults to 'manual' because no chain resolution was performed.
    expect(body.data.source).toBe("manual");
    expect(body.data.primaryColor).toBe("#000000");
    expect(body.data.secondaryColor).toBe("#FFFFFF");
    // Auto-flip fired: both colors set + no explicit needsReview override.
    expect(body.data.needsReview).toBe(false);

    const after = await getBrandAssetsForTool(toolWithoutAssetId);
    expect(after).not.toBeNull();
    expect(after?.source).toBe("manual");
  });

  it("rejects cross-project tool ID", async () => {
    // Seed a tool in the OTHER project, then try to PATCH it under THIS slug.
    const ts = Date.now();
    const [crossTool] = await db
      .insert(articles)
      .values({
        projectId: otherProjectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `cross-${ts}`,
        title: "Cross",
        status: "proposed",
      })
      .returning({ id: articles.id });
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${crossTool!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ primaryColor: "#000000" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug/tool-brand-assets/missing-count", () => {
  it("returns the count of tool-articles still without a row", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/missing-count`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { missing: number } };
    expect(body.data.missing).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/projects/:slug/tool-brand-assets/:toolId/usage", () => {
  it("counts cross-project siblings with the same slug", async () => {
    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${toolId}/usage`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { otherProjectCount: number; sharedSlug: string };
    };
    expect(body.data.sharedSlug).toBe(toolSlug);
    expect(body.data.otherProjectCount).toBe(1); // the otherProject's same-slug tool
  });

  it("does NOT count same-project EN-locale siblings (Spec 65.2 follow-up bug fix)", async () => {
    // Seed an EN sibling for `toolId` IN THE SAME PROJECT. Per Spec 59.2
    // Toolwiki bilingual setup, every tool has a DE + EN article row sharing
    // the slug — the multi-domain warning must NOT count those as
    // "different projects".
    const ts = Date.now();
    const bilingualSlug = `bilingual-${ts}`;
    const [de] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: bilingualSlug,
        title: "Bilingual DE",
        status: "proposed",
      })
      .returning({ id: articles.id });
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "en",
      slug: bilingualSlug,
      title: "Bilingual EN",
      status: "proposed",
    });

    const res = await app.fetch(
      authed(`/api/projects/${projectSlug}/tool-brand-assets/${de!.id}/usage`),
    );
    const body = (await res.json()) as {
      data: { otherProjectCount: number; siblingRowCount: number };
    };
    // No other project has this slug → 0, NOT 1. (Pre-fix this returned 1
    // because the EN sibling in THIS project was counted as a foreign project.)
    expect(body.data.otherProjectCount).toBe(0);
    expect(body.data.siblingRowCount).toBe(0);
  });
});

describe("POST /api/projects/:slug/tool-brand-assets/:toolId/upload-logo", () => {
  it("rejects non-SVG body with 400", async () => {
    const formData = new FormData();
    formData.append("file", new Blob(["<html>not svg</html>"], { type: "text/html" }), "fake.html");

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectSlug}/tool-brand-assets/${toolId}/upload-logo`,
        {
          method: "POST",
          body: formData,
          headers: { Cookie: `ma_session=${sessionToken}` },
        },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a valid SVG and flips source to 'manual'", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const formData = new FormData();
    formData.append("file", new Blob([svg], { type: "image/svg+xml" }), "custom.svg");

    const res = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectSlug}/tool-brand-assets/${toolId}/upload-logo`,
        {
          method: "POST",
          body: formData,
          headers: { Cookie: `ma_session=${sessionToken}` },
        },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { source: string; logoUrl: string | null } };
    expect(body.data.source).toBe("manual");
    expect(body.data.logoUrl).toBeTruthy();

    const persisted = await getBrandAssetsForTool(toolId);
    expect(persisted?.source).toBe("manual");
  });
});
