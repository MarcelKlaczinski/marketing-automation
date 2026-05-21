// Spec 62.7: verify that upsertProjectPlannerConfig keeps the
// cron_state.cron_pattern + is_active in sync with the persisted
// project_planner_config.cronEnabled/cronDayOfWeek/cronHourUtc fields.
//
// Three guards under test:
//   1. UPDATE only — INSERT lives at worker startup + project create.
//   2. Existing row is updated correctly when cron toggle flips on.
//   3. Omitting cron-fields in the upsert leaves cron_state untouched.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  buildPlannerCronPattern,
  cronState,
  db,
  projects,
  upsertProjectPlannerConfig,
} from "../src/index.ts";

describe("planner-config cron sync (Spec 62.7)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `cron-sync-${ts}`,
        name: "Cron Sync Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project insert failed");
    projectId = proj.id;

    // Mimic the per-new-project INSERT in routes/projects.ts so the sync helper
    // has a row to UPDATE (otherwise the UPDATE is a no-op).
    await db
      .insert(cronState)
      .values({
        projectId,
        jobType: "planner_weekly_generation",
        isActive: false,
        cronPattern: buildPlannerCronPattern(0, 18),
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // FK cascade deletes cron_state + project_planner_config rows.
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function readCronStateRow() {
    const rows = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "planner_weekly_generation"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  it("buildPlannerCronPattern composes minute-fixed pattern", () => {
    expect(buildPlannerCronPattern(0, 18)).toBe("0 18 * * 0");
    expect(buildPlannerCronPattern(3, 8)).toBe("0 8 * * 3");
    expect(buildPlannerCronPattern(6, 23)).toBe("0 23 * * 6");
  });

  it("syncs cron_state.is_active + cron_pattern when cron fields are set", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      cronEnabled: true,
      cronDayOfWeek: 3,
      cronHourUtc: 14,
    });

    const row = await readCronStateRow();
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(true);
    expect(row?.cronPattern).toBe("0 14 * * 3");
  });

  it("flips is_active off when cronEnabled = false (and updates pattern)", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      cronEnabled: false,
      cronDayOfWeek: 5,
      cronHourUtc: 9,
    });

    const row = await readCronStateRow();
    expect(row?.isActive).toBe(false);
    expect(row?.cronPattern).toBe("0 9 * * 5");
  });

  it("leaves cron_state untouched when upsert omits cron-fields", async () => {
    // Seed a known state first.
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      cronEnabled: true,
      cronDayOfWeek: 2,
      cronHourUtc: 10,
    });
    const before = await readCronStateRow();

    // Upsert without cron fields — only budget changes.
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 100,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });

    const after = await readCronStateRow();
    expect(after?.isActive).toBe(before?.isActive);
    expect(after?.cronPattern).toBe(before?.cronPattern);
  });
});
