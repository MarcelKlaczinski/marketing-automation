// Spec 62.0a-followup Issue 1 — API tests for PATCH /:id/skip-translation.
//
// Uses app.fetch directly with a session-cookie fixture so the requireAuth
// middleware accepts the request. Run: bun --filter @marketing-auto/api test
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects, sessions, users } from "@marketing-auto/db";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

describe("PATCH /api/articles/:id/skip-translation", () => {
  let projectId: string;
  let articleId: string;
  let sessionToken: string;
  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `skip-xlate-api-${Date.now()}@test.local`,
        name: "Skip Test",
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

    const [proj] = await db
      .insert(projects)
      .values({
        slug: `skip-xlate-api-${Date.now()}`,
        name: "skip-xlate-api",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    const [art] = await db
      .insert(articles)
      .values({
        projectId,
        title: "Skip xlate test",
        slug: `skip-xlate-${Date.now()}`,
        status: "published",
        source: "generated",
        locale: "de",
        translationKey: `skip-xlate-${Date.now()}`,
        bodyMd: "body",
      })
      .returning({ id: articles.id });
    articleId = art!.id;
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  function authedRequest(body: unknown): Request {
    return new Request(`http://localhost/api/articles/${articleId}/skip-translation`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ma_session=${sessionToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("PATCH sets skipUntil; GET (via DB) reflects it", async () => {
    const skipUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.fetch(authedRequest({ skipUntil }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { skipAutoTranslationUntil: string } };
    expect(body.ok).toBe(true);
    expect(body.data.skipAutoTranslationUntil).toBe(skipUntil);

    const [art] = await db
      .select({ skipAutoTranslationUntil: articles.skipAutoTranslationUntil })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(art!.skipAutoTranslationUntil?.toISOString()).toBe(skipUntil);
  });

  it("PATCH with null clears the field", async () => {
    // Seed a value first so we can verify the clear path is meaningful.
    await db
      .update(articles)
      .set({ skipAutoTranslationUntil: new Date(Date.now() + 86400_000) })
      .where(eq(articles.id, articleId));

    const res = await app.fetch(authedRequest({ skipUntil: null }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { skipAutoTranslationUntil: string | null } };
    expect(body.ok).toBe(true);
    expect(body.data.skipAutoTranslationUntil).toBeNull();

    const [art] = await db
      .select({ skipAutoTranslationUntil: articles.skipAutoTranslationUntil })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(art!.skipAutoTranslationUntil).toBeNull();
  });
});
