// Spec 64.14 Phase C — POST /api/projects/:slug/briefs (manual brief creation).
// Pattern mirrors apps/api/test/routes/trends-approve.test.ts: bun:test with
// real DB, per-suite project + session, app.fetch(new Request(...)) for HTTP.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
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
let slug: string;
let sessionToken: string;
let userId: string;
const createdBriefIds: string[] = [];

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `briefs-create-${Date.now()}@test.local`,
      name: "Briefs Create Test",
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

  slug = `briefs-create-${Date.now()}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Briefs Create Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterAll(async () => {
  for (const id of createdBriefIds) {
    await db.delete(topicBriefs).where(eq(topicBriefs.id, id));
  }
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

async function postBrief(body: Record<string, unknown>) {
  return app.fetch(
    authed(`/api/projects/${slug}/briefs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/projects/:slug/briefs (Spec 64.14 Phase C)", () => {
  it("creates ki-wissen brief with explicit knowledge intent", async () => {
    const res = await postBrief({
      topicTitle: "Was ist Retrieval-Augmented Generation?",
      primaryKeyword: "RAG",
      collectionHint: "ki-wissen",
      intentType: "knowledge",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { brief: typeof topicBriefs.$inferSelect };
    };
    expect(body.ok).toBe(true);
    expect(body.data.brief.source).toBe("manual");
    expect(body.data.brief.intentType).toBe("knowledge");
    expect(body.data.brief.approvalStatus).toBe("pending");
    expect(body.data.brief.clusterAction).toBe("standalone");
    expect(body.data.brief.primaryKeyword).toBe("RAG");
    createdBriefIds.push(body.data.brief.id);
  });

  it("auto-derives intent_type=knowledge from collectionHint=ki-wissen", async () => {
    const res = await postBrief({
      topicTitle: "Was ist ein Large Language Model?",
      primaryKeyword: "LLM",
      collectionHint: "ki-wissen",
      // no explicit intentType
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { brief: typeof topicBriefs.$inferSelect };
    };
    expect(body.data.brief.intentType).toBe("knowledge");
    createdBriefIds.push(body.data.brief.id);
  });

  it("derives cluster_action=create_new for collectionHint=cluster", async () => {
    const res = await postBrief({
      topicTitle: "Vergleich aller großen KI-Coding-Assistenten 2026",
      primaryKeyword: "KI Coding Assistenten",
      collectionHint: "cluster",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { brief: typeof topicBriefs.$inferSelect };
    };
    expect(body.data.brief.clusterAction).toBe("create_new");
    createdBriefIds.push(body.data.brief.id);
  });

  it("returns 400 for too-short topic title", async () => {
    const res = await postBrief({
      topicTitle: "Short",
      primaryKeyword: "AI",
      collectionHint: "ki-wissen",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project slug", async () => {
    const res = await app.fetch(
      authed("/api/projects/nonexistent-spec-64-14/briefs", {
        method: "POST",
        body: JSON.stringify({
          topicTitle: "Some valid topic title here",
          primaryKeyword: "AI",
          collectionHint: "ki-wissen",
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("project_not_found");
  });

  it("persists source='manual' in DB (CHECK constraint admits the value)", async () => {
    const res = await postBrief({
      topicTitle: "Was ist Prompt Engineering?",
      primaryKeyword: "prompt engineering",
      collectionHint: "ki-wissen",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { brief: { id: string } };
    };
    const briefId = body.data.brief.id;
    createdBriefIds.push(briefId);

    const [row] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, briefId));
    expect(row?.source).toBe("manual");
    expect(row?.approvalStatus).toBe("pending");
  });

  it("rejects request without auth (401)", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${slug}/briefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicTitle: "Was ist Embeddings?",
          primaryKeyword: "embeddings",
          collectionHint: "ki-wissen",
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
