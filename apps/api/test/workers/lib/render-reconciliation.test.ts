// Spec 64.11 Fix A tests — `reconcileStalledRenders` resets stale rendering
// rows so the next worker poll finds clean state. Real DB; no mocks.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, eq, pipelineRuns, projects, socialPosts } from "@marketing-auto/db";
import { reconcileStalledRenders } from "../../../src/workers/lib/render-reconciliation.ts";

const STALE_MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60 * 1000);

describe("reconcileStalledRenders (Spec 64.11 Fix A)", () => {
  let projectId: string;

  beforeEach(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `reconcile-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: "Reconcile Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterEach(async () => {
    // CASCADE removes social_posts + pipeline_runs.
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("resets social_posts where renderStartedAt is older than the cutoff", async () => {
    const sixteenMinAgo = STALE_MINUTES_AGO(16);
    const [stuck] = await db
      .insert(socialPosts)
      .values({
        projectId,
        platform: "instagram",
        format: "carousel",
        content: { kind: "carousel", slides: [], caption: "", hashtags: [] },
        renderStatus: "rendering",
        renderStartedAt: sixteenMinAgo,
      })
      .returning({ id: socialPosts.id });

    const summary = await reconcileStalledRenders({ cutoffMinutes: 15 });
    expect(summary.socialPostsReset).toBe(1);

    const [row] = await db
      .select({
        renderStatus: socialPosts.renderStatus,
        renderStartedAt: socialPosts.renderStartedAt,
      })
      .from(socialPosts)
      .where(eq(socialPosts.id, stuck!.id));
    expect(row?.renderStatus).toBe("pending");
    expect(row?.renderStartedAt).toBeNull();
  });

  it("does NOT reset social_posts inside the cutoff window", async () => {
    const fiveMinAgo = STALE_MINUTES_AGO(5);
    const [fresh] = await db
      .insert(socialPosts)
      .values({
        projectId,
        platform: "instagram",
        format: "carousel",
        content: { kind: "carousel", slides: [], caption: "", hashtags: [] },
        renderStatus: "rendering",
        renderStartedAt: fiveMinAgo,
      })
      .returning({ id: socialPosts.id });

    const summary = await reconcileStalledRenders({ cutoffMinutes: 15 });
    expect(summary.socialPostsReset).toBe(0);

    const [row] = await db
      .select({
        renderStatus: socialPosts.renderStatus,
        renderStartedAt: socialPosts.renderStartedAt,
      })
      .from(socialPosts)
      .where(eq(socialPosts.id, fresh!.id));
    expect(row?.renderStatus).toBe("rendering");
    expect(row?.renderStartedAt).not.toBeNull();
  });

  it("is idempotent — second invocation finds nothing", async () => {
    const sixteenMinAgo = STALE_MINUTES_AGO(16);
    await db.insert(socialPosts).values({
      projectId,
      platform: "instagram",
      format: "carousel",
      content: { kind: "carousel", slides: [], caption: "", hashtags: [] },
      renderStatus: "rendering",
      renderStartedAt: sixteenMinAgo,
    });

    const first = await reconcileStalledRenders({ cutoffMinutes: 15 });
    expect(first.socialPostsReset).toBe(1);

    const second = await reconcileStalledRenders({ cutoffMinutes: 15 });
    expect(second.socialPostsReset).toBe(0);
  });

  it("resets pipeline_runs.status=running rows to failed with audit message", async () => {
    const sixteenMinAgo = STALE_MINUTES_AGO(16);
    const [stuck] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:blog",
        status: "running",
        startedAt: sixteenMinAgo,
      })
      .returning({ id: pipelineRuns.id });

    const summary = await reconcileStalledRenders({ cutoffMinutes: 15 });
    expect(summary.pipelineRunsReset).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({
        status: pipelineRuns.status,
        errorMessage: pipelineRuns.errorMessage,
        completedAt: pipelineRuns.completedAt,
      })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, stuck!.id));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toContain("reconciled");
    expect(row?.completedAt).not.toBeNull();
  });

  it("does NOT touch pipeline_runs with non-running status (queued / batch_pending / paused)", async () => {
    const sixteenMinAgo = STALE_MINUTES_AGO(16);
    const [queued] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:blog",
        status: "queued",
        startedAt: sixteenMinAgo,
      })
      .returning({ id: pipelineRuns.id });
    const [batchPending] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:blog",
        status: "batch_pending",
        startedAt: sixteenMinAgo,
      })
      .returning({ id: pipelineRuns.id });
    const [paused] = await db
      .insert(pipelineRuns)
      .values({
        projectId,
        pipelineName: "article:blog",
        status: "paused",
        startedAt: sixteenMinAgo,
      })
      .returning({ id: pipelineRuns.id });

    await reconcileStalledRenders({ cutoffMinutes: 15 });

    const ids = [queued!.id, batchPending!.id, paused!.id];
    for (const id of ids) {
      const [row] = await db
        .select({ status: pipelineRuns.status })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.id, id));
      expect(row?.status).not.toBe("failed");
    }
  });
});
