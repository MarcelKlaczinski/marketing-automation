// Spec 63.4: verify the trends_synthesizer leg of upsertProjectPlannerConfig.
//
// Two specifics vs the 62.7 / 63.3b crons:
//   1. dayOfWeek is nullable — null encodes daily cadence and renders as `*`
//      in the cron pattern.
//   2. The cron_state row uses job_type='trends_synthesizer' (plural, exists
//      since Spec 56.6).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  buildTrendSynthCronPattern,
  cronState,
  db,
  projects,
  upsertProjectPlannerConfig,
} from "../src/index.ts";

describe("trend-synth cron sync (Spec 63.4)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `trend-synth-sync-${ts}`,
        name: "Trend-Synth Sync Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project insert failed");
    projectId = proj.id;

    // Mimic the per-new-project INSERT in routes/projects.ts. Without the row
    // present, the UPDATE inside the upsert helper would be a no-op.
    await db
      .insert(cronState)
      .values({
        projectId,
        jobType: "trends_synthesizer",
        isActive: false,
        cronPattern: buildTrendSynthCronPattern(null, 1),
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function readCronStateRow() {
    const rows = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "trends_synthesizer"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  describe("buildTrendSynthCronPattern", () => {
    it("renders daily when dayOfWeek is null", () => {
      expect(buildTrendSynthCronPattern(null, 1)).toBe("0 1 * * *");
      expect(buildTrendSynthCronPattern(null, 0)).toBe("0 0 * * *");
      expect(buildTrendSynthCronPattern(null, 23)).toBe("0 23 * * *");
    });

    it("renders weekly when dayOfWeek is 0-6", () => {
      expect(buildTrendSynthCronPattern(0, 18)).toBe("0 18 * * 0");
      expect(buildTrendSynthCronPattern(3, 8)).toBe("0 8 * * 3");
      expect(buildTrendSynthCronPattern(6, 23)).toBe("0 23 * * 6");
    });
  });

  it("syncs cron_state.cron_pattern + is_active for daily cadence", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      trendSynthCronEnabled: true,
      trendSynthCronDayOfWeek: null,
      trendSynthCronHourUtc: 2,
    });

    const row = await readCronStateRow();
    expect(row?.isActive).toBe(true);
    expect(row?.cronPattern).toBe("0 2 * * *");
  });

  it("syncs cron_state.cron_pattern + is_active for weekly cadence", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      trendSynthCronEnabled: true,
      trendSynthCronDayOfWeek: 4,
      trendSynthCronHourUtc: 7,
    });

    const row = await readCronStateRow();
    expect(row?.isActive).toBe(true);
    expect(row?.cronPattern).toBe("0 7 * * 4");
  });

  it("leaves cron_state untouched when upsert omits trend-synth fields", async () => {
    // Seed a known state.
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      trendSynthCronEnabled: true,
      trendSynthCronDayOfWeek: 2,
      trendSynthCronHourUtc: 10,
    });
    const before = await readCronStateRow();

    // Upsert without trend-synth fields — only budget changes.
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 200,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });

    const after = await readCronStateRow();
    expect(after?.isActive).toBe(before?.isActive);
    expect(after?.cronPattern).toBe(before?.cronPattern);
  });
});
