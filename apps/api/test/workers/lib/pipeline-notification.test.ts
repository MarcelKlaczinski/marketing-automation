// Spec 64.11 Fix B tests — `notifyPipelineCompletion` fans out per project
// owner with rich-payload deep links, coalesces by pipelineRunId, and swallows
// errors so a notification miss never escalates into a worker failure.
//
// Real DB; no mocks for createNotification — we assert against `notifications`
// rows directly. The helper coalesces ACROSS users on `pipelineRunId`, so all
// tests use a per-invocation unique id stamp to avoid colliding with prior
// test runs (whose owner rows on real-tenant projects don't get cleaned up).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { and, articles, db, eq, notifications, projects, sql, users } from "@marketing-auto/db";
import { notifyPipelineCompletion } from "@marketing-auto/core/notifications";

interface SeedContext {
  projectId: string;
  projectSlug: string;
  articleId: string;
  articleSlug: string;
  ownerUserId: string;
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seed(): Promise<SeedContext> {
  const s = stamp();
  const [project] = await db
    .insert(projects)
    .values({
      slug: `notify-test-${s}`,
      name: `Notify Test ${s}`,
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id, slug: projects.slug });
  const [article] = await db
    .insert(articles)
    .values({
      projectId: project!.id,
      slug: `notify-article-${s}`,
      title: "How to ship features",
      status: "drafting",
      locale: "de",
      source: "generated",
    })
    .returning({ id: articles.id, slug: articles.slug });
  const [owner] = await db
    .insert(users)
    .values({
      email: `notify-owner-${s}@example.com`,
      role: "owner",
      emailVerified: true,
    })
    .returning({ id: users.id });
  return {
    projectId: project!.id,
    projectSlug: project!.slug!,
    articleId: article!.id,
    articleSlug: article!.slug!,
    ownerUserId: owner!.id,
  };
}

describe("notifyPipelineCompletion (Spec 64.11 Fix B)", () => {
  let ctx: SeedContext;
  const extraUserIds: string[] = [];

  beforeEach(async () => {
    ctx = await seed();
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, ctx.ownerUserId));
    for (const id of extraUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
    extraUserIds.length = 0;
    await db.delete(projects).where(eq(projects.id, ctx.projectId));
  });

  async function listForRunOnOwner(runId: string, userId: string) {
    return db
      .select({
        type: notifications.type,
        severity: notifications.severity,
        title: notifications.title,
        message: notifications.message,
        link: notifications.link,
        metadata: notifications.metadata,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          sql`${notifications.metadata}->>'pipelineRunId' = ${runId}`,
        ),
      );
  }

  it("dispatches a success notification (severity=info) for article:blog with deep link", async () => {
    const runId = `run-success-${stamp()}`;
    await notifyPipelineCompletion({
      pipelineName: "article:blog",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      articleId: ctx.articleId,
      status: "success",
    });

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.type).toBe("pipeline_completed");
    expect(rows[0]?.severity).toBe("info");
    expect(rows[0]?.title).toContain("How to ship features");
    expect(rows[0]?.link).toBe(`/projects/${ctx.projectSlug}/articles/${ctx.articleSlug}`);
    const meta = rows[0]?.metadata as Record<string, unknown> | null;
    expect(meta?.pipelineRunId).toBe(runId);
    expect(meta?.articleId).toBe(ctx.articleId);
  });

  it("dispatches a failure notification (severity=critical) with the error message", async () => {
    const runId = `run-failed-${stamp()}`;
    await notifyPipelineCompletion({
      pipelineName: "article:blog",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      articleId: ctx.articleId,
      status: "failed",
      errorMessage: "Anthropic rate limit",
    });

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.severity).toBe("critical");
    expect(rows[0]?.title).toContain("failed");
    expect(rows[0]?.message).toBe("Anthropic rate limit");
  });

  it("coalesces — second dispatch with same pipelineRunId is a no-op", async () => {
    const runId = `run-coalesce-${stamp()}`;
    await notifyPipelineCompletion({
      pipelineName: "article:blog",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      articleId: ctx.articleId,
      status: "success",
    });
    await notifyPipelineCompletion({
      pipelineName: "article:blog",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      articleId: ctx.articleId,
      status: "success",
    });

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(1);
  });

  it("fans out to multiple owners (project-broadcast)", async () => {
    const s = stamp();
    const [secondOwner] = await db
      .insert(users)
      .values({
        email: `notify-owner-2-${s}@example.com`,
        role: "owner",
        emailVerified: true,
      })
      .returning({ id: users.id });
    extraUserIds.push(secondOwner!.id);

    const runId = `run-fanout-${s}`;
    await notifyPipelineCompletion({
      pipelineName: "article:blog",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      articleId: ctx.articleId,
      status: "success",
    });

    // The helper fans out to EVERY user with role='owner' — there are
    // pre-existing tenant owners in the DB beyond the two we created, so the
    // total row count is not deterministic. Assert only that both of OUR
    // owners received their slice of the broadcast.
    const ownerRow = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(ownerRow.length).toBe(1);
    const secondRow = await listForRunOnOwner(runId, secondOwner!.id);
    expect(secondRow.length).toBe(1);
  });

  it("dispatches a social-render success notification with social link", async () => {
    const runId = `run-social-${stamp()}`;
    await notifyPipelineCompletion({
      pipelineName: "social-render",
      projectId: ctx.projectId,
      pipelineRunId: runId,
      socialPostId: "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
      status: "success",
    });

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.title).toContain("social post rendered");
    expect(rows[0]?.link).toBe(`/projects/${ctx.projectSlug}/social`);
  });

  it("does not throw when articleId is missing for article:blog — logs and skips", async () => {
    const runId = `run-no-article-${stamp()}`;
    await expect(
      notifyPipelineCompletion({
        pipelineName: "article:blog",
        projectId: ctx.projectId,
        pipelineRunId: runId,
        status: "success",
      }),
    ).resolves.toBeUndefined();

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(0);
  });

  it("does not throw when the project no longer exists — silent skip", async () => {
    const runId = `run-no-project-${stamp()}`;
    // Delete the project before dispatching; helper should log + return.
    await db.delete(projects).where(eq(projects.id, ctx.projectId));

    await expect(
      notifyPipelineCompletion({
        pipelineName: "article:blog",
        projectId: ctx.projectId,
        pipelineRunId: runId,
        articleId: ctx.articleId,
        status: "success",
      }),
    ).resolves.toBeUndefined();

    const rows = await listForRunOnOwner(runId, ctx.ownerUserId);
    expect(rows.length).toBe(0);
  });
});
