// Spec 62.0a Section 7 + Section 10: end-to-end smoke test for the step-pause notification.
// Pins the coalescing contract (one unread notification per pipelineRunId) and the
// owner-fan-out behavior.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  and,
  db,
  eq,
  notifications,
  projects,
  sql,
  users,
} from "@marketing-auto/db";
import {
  notifyStepPaused,
  STEP_PAUSED_NOTIFICATION_TYPE,
} from "../../src/notifications/index.ts";

const TS = Date.now();
const PAUSE_RUN_ID = "00000000-0000-0000-0000-0000aaaaaaaa";

describe("notifyStepPaused (Spec 62.0a Phase 5)", () => {
  let projectId: string;
  let ownerId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `notify-test-${TS}`,
        name: "Notify Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!p) throw new Error("project insert failed");
    projectId = p.id;

    const [u] = await db
      .insert(users)
      .values({
        email: `notify-test-${TS}@example.com`,
        name: "Notify Test Owner",
        role: "owner",
      })
      .returning();
    if (!u) throw new Error("user insert failed");
    ownerId = u.id;
  });

  afterAll(async () => {
    await db
      .delete(notifications)
      .where(
        sql`${notifications.metadata}->>'pipelineRunId' = ${PAUSE_RUN_ID}`
      );
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  beforeEach(async () => {
    // Reset notifications for this run between tests so each test starts clean.
    await db
      .delete(notifications)
      .where(
        sql`${notifications.metadata}->>'pipelineRunId' = ${PAUSE_RUN_ID}`
      );
  });

  it("creates one notification per owner with severity='info' and the deep-link", async () => {
    await notifyStepPaused({
      projectId,
      pipelineRunId: PAUSE_RUN_ID,
      pipelineName: "article:outline",
      stepName: "outline",
      stepPauseId: "00000000-0000-0000-0000-0000bbbbbbbb",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE)
        )
      );
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.severity).toBe("info");
    expect(row.link).toBe(`/projects/notify-test-${TS}/paused-runs`);
    expect(row.message).toContain("article:outline");
    expect((row.metadata as Record<string, unknown>).pipelineRunId).toBe(PAUSE_RUN_ID);
    expect((row.metadata as Record<string, unknown>).stepName).toBe("outline");
  });

  it("coalesces: a second call for the same pipelineRunId does NOT create a duplicate while the first is unread", async () => {
    await notifyStepPaused({
      projectId,
      pipelineRunId: PAUSE_RUN_ID,
      pipelineName: "article:outline",
      stepName: "outline",
      stepPauseId: "00000000-0000-0000-0000-0000aaaa0001",
    });
    await notifyStepPaused({
      projectId,
      pipelineRunId: PAUSE_RUN_ID,
      pipelineName: "article:outline",
      stepName: "draft", // different step, SAME run
      stepPauseId: "00000000-0000-0000-0000-0000aaaa0002",
    });
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE)
        )
      );
    expect(rows.length).toBe(1);
  });

  it("max 1 notification per pipelineRunId EVER (even after the prior one is marked read)", async () => {
    // Spec Section 10 wants idempotency at the run level — once the user has been told
    // about a run, additional pauses in that run don't fire new notifications.
    await notifyStepPaused({
      projectId,
      pipelineRunId: PAUSE_RUN_ID,
      pipelineName: "article:outline",
      stepName: "outline",
      stepPauseId: "00000000-0000-0000-0000-0000aaaa0001",
    });
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE)
        )
      );

    await notifyStepPaused({
      projectId,
      pipelineRunId: PAUSE_RUN_ID,
      pipelineName: "article:outline",
      stepName: "draft",
      stepPauseId: "00000000-0000-0000-0000-0000aaaa0002",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE)
        )
      );
    expect(rows.length).toBe(1);
  });
});
