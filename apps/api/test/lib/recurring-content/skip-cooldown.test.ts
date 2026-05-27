/**
 * Spec 65.V1.5b — Brief-skip notification cooldown gate.
 *
 * Tests the 24h cooldown predicate and the timestamp-update side effect.
 * Notifications themselves are mocked at the module level so the DB write
 * (update last_skip_notified_at) is the only observable.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

// IMPORTANT: mock BEFORE importing the SUT so its `notifyRecurringBriefSkipped`
// import resolves to the mock. Bun mock.module is process-global per the apps/api
// CLAUDE.md gotcha; this test file scopes to itself via per-package CI.
const notifyCalls: Array<unknown> = [];
mock.module(
  "../../../src/lib/recurring-content/notify-skipped.ts",
  () => ({
    notifyRecurringBriefSkipped: (input: unknown) => {
      notifyCalls.push(input);
      return Promise.resolve();
    },
  }),
);

const { notifyBriefSkippedWithCooldown, SKIP_COOLDOWN_MS } = await import(
  "../../../src/lib/recurring-content/skip-cooldown.ts"
);
const { db, eq, projects, recurringContentDefinitions } = await import("@marketing-auto/db");

describe("notifyBriefSkippedWithCooldown (Spec 65.V1.5b)", () => {
  let projectId: string;
  let definitionId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `skip-cooldown-${ts}`,
        name: "skip-cooldown test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "Test recurring definition",
        formatType: "top-n-comparison",
        formatConfig: {},
        frequency: "weekly",
        nextRunAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    if (!def) throw new Error("definition INSERT failed");
    definitionId = def.id;
  });

  afterAll(async () => {
    await db
      .delete(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.id, definitionId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("fires notification + updates timestamp when lastSkipNotifiedAt is null", async () => {
    notifyCalls.length = 0;
    const fired = await notifyBriefSkippedWithCooldown({
      projectId,
      definitionId,
      definitionName: "Test",
      reason: "brand-assets-missing",
      lastSkipNotifiedAt: null,
    });
    expect(fired).toBe(true);
    expect(notifyCalls.length).toBe(1);

    const [row] = await db
      .select({ lastSkipNotifiedAt: recurringContentDefinitions.lastSkipNotifiedAt })
      .from(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.id, definitionId));
    expect(row?.lastSkipNotifiedAt).toBeTruthy();
  });

  it("suppresses notification within 24h window", async () => {
    notifyCalls.length = 0;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const fired = await notifyBriefSkippedWithCooldown({
      projectId,
      definitionId,
      definitionName: "Test",
      reason: "brand-assets-missing",
      lastSkipNotifiedAt: oneHourAgo,
    });
    expect(fired).toBe(false);
    expect(notifyCalls.length).toBe(0);
  });

  it("fires notification after cooldown expires", async () => {
    notifyCalls.length = 0;
    const oldEnough = new Date(Date.now() - SKIP_COOLDOWN_MS - 60_000); // 24h + 1min ago
    const fired = await notifyBriefSkippedWithCooldown({
      projectId,
      definitionId,
      definitionName: "Test",
      reason: "no-hook",
      lastSkipNotifiedAt: oldEnough,
    });
    expect(fired).toBe(true);
    expect(notifyCalls.length).toBe(1);
  });

  it("preserves optional fields (detail + missingToolIds) in the notification payload", async () => {
    notifyCalls.length = 0;
    await notifyBriefSkippedWithCooldown({
      projectId,
      definitionId,
      definitionName: "Test",
      reason: "insufficient-tools",
      detail: "Only 2 tools matched; need 5",
      missingToolIds: ["tool-a", "tool-b"],
      lastSkipNotifiedAt: null,
    });
    expect(notifyCalls.length).toBe(1);
    const payload = notifyCalls[0] as Record<string, unknown>;
    expect(payload.detail).toBe("Only 2 tools matched; need 5");
    expect(payload.missingToolIds).toEqual(["tool-a", "tool-b"]);
  });
});
